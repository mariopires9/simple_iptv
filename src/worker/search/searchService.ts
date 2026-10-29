// Search index storage and queries in the data worker (SCH-01, ADR-009).
//
// - Build: after a successful sync (hook passed to both providers' sync in ../tasks.ts) and on
//   demand when a query finds no usable index. Builds of a source are serialised in this worker,
//   so the last build always reflects the last write.
// - Storage: one `searchIndex` row per source (`catalogRepo.putSearchIndexForExistingSource`,
//   never written for a removed source). Removing a source deletes its row (sourcesRepo.remove).
// - Load: the index of the queried source is kept in memory (one source at a time, the active
//   list); after an app reopen it is parsed from IndexedDB, not rebuilt.
// - Staleness: a stored or cached index older than the last successful write of any type
//   (`lastSyncByType[type].lastOkAt`, e.g. a sync cancelled after some types were written) or
//   with another format version is rebuilt.
// - Queries run here, never on the main thread; hits are hydrated with the catalogue rows (name,
//   number, year, category name) so the UI needs no extra reads.
// Logs carry the source id, counts and timings only (never names or queries).
import {
  CONTENT_TYPES,
  catalogRepo,
  sourcesRepo,
  type CatalogItem,
  type CatalogItemByType,
  type ContentType,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import {
  SEARCH_INDEX_VERSION,
  buildSearchIndex,
  isSearchableQuery,
  loadSearchIndex,
  querySearchIndex,
  serializeSearchIndex,
  type RawHit,
  type SearchIndex,
} from './searchIndex';

/** Default and maximum number of hits per type returned by a query. */
export const DEFAULT_RESULTS_PER_TYPE = 20;
export const MAX_RESULTS_PER_TYPE = 200;

export interface SearchQueryInput {
  sourceId: string;
  query: string;
  /** Types to search (default all). */
  types?: readonly ContentType[];
  /** Hits per type (default 20, max. 200). */
  limit?: number;
}

/** A search result, ready to display. Never contains stream URLs or images. */
export interface SearchHit {
  key: string;
  type: ContentType;
  externalId: string;
  name: string;
  /** Category of the item (its external id and display name; the name may be empty). */
  categoryId?: string;
  categoryName?: string;
  /** Channel number. */
  number?: number;
  /** Movie/series year. */
  year?: number;
}

export interface SearchGroup {
  total: number;
  hits: SearchHit[];
}

export interface SearchQueryResult {
  sourceId: string;
  query: string;
  groups: Record<ContentType, SearchGroup>;
}

export interface SearchWarmupResult {
  sourceId: string;
  /** Where the index came from: already in memory, parsed from IndexedDB, or built now. */
  from: 'memory' | 'storage' | 'build' | 'none';
  items: number;
}

interface LoadedIndex {
  sourceId: string;
  index: SearchIndex;
  builtAt: number;
}

/** The in-memory index (one source: the active list). */
let cached: LoadedIndex | undefined;
/** Tail of each source's build queue. */
const builds = new Map<string, Promise<LoadedIndex | undefined>>();

/** Latest successful write of any type of the source (0 when unknown). */
function lastWriteAt(source: Source): number {
  let latest = 0;
  for (const type of CONTENT_TYPES) {
    const at = source.lastSyncByType?.[type]?.lastOkAt;
    if (typeof at === 'number' && at > latest) latest = at;
  }
  return latest;
}

async function readCatalog(sourceId: string): Promise<CatalogItem[]> {
  const lists = await Promise.all(CONTENT_TYPES.map((t) => catalogRepo.listForSource(sourceId, t)));
  return lists.flat();
}

async function buildNow(sourceId: string, now: () => number): Promise<LoadedIndex | undefined> {
  const startedAt = performance.now();
  const builtAt = now();
  const items = await readCatalog(sourceId);
  const index = buildSearchIndex(items);
  const entry = {
    sourceId,
    data: serializeSearchIndex(index),
    builtAt,
    version: SEARCH_INDEX_VERSION,
    items: index.documentCount,
  };
  if (!(await catalogRepo.putSearchIndexForExistingSource(entry))) {
    if (cached?.sourceId === sourceId) cached = undefined;
    return undefined;
  }
  const loaded: LoadedIndex = { sourceId, index, builtAt };
  // Replace the cached index of this source (or take the slot if no index is loaded).
  if (cached === undefined || cached.sourceId === sourceId) cached = loaded;
  log.info('search: index built', {
    sourceId,
    items: index.documentCount,
    bytes: entry.data.length,
    ms: Math.round(performance.now() - startedAt),
  });
  return loaded;
}

/**
 * Builds and stores the index of `sourceId` (queued after any build of the same source in
 * progress). Resolves `undefined` when the source no longer exists. Rejects on storage errors.
 */
export function rebuildSearchIndex(
  sourceId: string,
  now: () => number = Date.now,
): Promise<LoadedIndex | undefined> {
  const previous = builds.get(sourceId) ?? Promise.resolve(undefined);
  const mine = previous.catch(() => undefined).then(() => buildNow(sourceId, now));
  builds.set(sourceId, mine);
  const settle = () => {
    if (builds.get(sourceId) === mine) builds.delete(sourceId);
  };
  mine.then(settle, settle);
  return mine;
}

/**
 * Sync hook (both providers): rebuilds the index after a sync that wrote data. Never throws —
 * a failed index build must not fail the sync (the next query rebuilds it on demand).
 */
export async function rebuildSearchIndexAfterSync(sourceId: string): Promise<void> {
  try {
    await rebuildSearchIndex(sourceId);
  } catch (error) {
    log.warn('search: index build after sync failed', { sourceId, error });
  }
}

/** The usable index of a source: memory, else IndexedDB, else a new build. */
async function getIndex(
  sourceId: string,
): Promise<{ loaded: LoadedIndex; from: SearchWarmupResult['from'] } | undefined> {
  const pending = builds.get(sourceId);
  if (pending) {
    const loaded = await pending.catch(() => undefined);
    if (loaded) return { loaded, from: 'build' };
  }
  const source = await sourcesRepo.get(sourceId);
  if (!source) {
    if (cached?.sourceId === sourceId) cached = undefined;
    return undefined;
  }
  const writtenAt = lastWriteAt(source);
  if (cached?.sourceId === sourceId && cached.builtAt >= writtenAt) {
    return { loaded: cached, from: 'memory' };
  }
  const stored = await catalogRepo.getSearchIndex(sourceId);
  if (stored && stored.version === SEARCH_INDEX_VERSION && stored.builtAt >= writtenAt) {
    try {
      const startedAt = performance.now();
      const loaded: LoadedIndex = {
        sourceId,
        index: loadSearchIndex(stored.data),
        builtAt: stored.builtAt,
      };
      cached = loaded;
      log.info('search: index loaded', {
        sourceId,
        items: loaded.index.documentCount,
        ms: Math.round(performance.now() - startedAt),
      });
      return { loaded, from: 'storage' };
    } catch (error) {
      log.warn('search: stored index unreadable, rebuilding', { sourceId, error });
    }
  }
  // Missing, stale, from another format or corrupt: build it now.
  if (cached?.sourceId !== sourceId) cached = undefined;
  const loaded = await rebuildSearchIndex(sourceId);
  return loaded ? { loaded, from: 'build' } : undefined;
}

/** Loads (or builds) the index of `sourceId` into memory ahead of the first query. */
export async function warmUpSearch(sourceId: string): Promise<SearchWarmupResult> {
  const found = await getIndex(sourceId);
  return {
    sourceId,
    from: found?.from ?? 'none',
    items: found?.loaded.index.documentCount ?? 0,
  };
}

function emptyGroups(): Record<ContentType, SearchGroup> {
  return {
    live: { total: 0, hits: [] },
    movie: { total: 0, hits: [] },
    series: { total: 0, hits: [] },
  };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_RESULTS_PER_TYPE;
  return Math.min(MAX_RESULTS_PER_TYPE, Math.max(1, Math.floor(limit)));
}

/** Reads the rows of the hits (one bulk read per type) and keeps the ones that still exist. */
async function hydrate(type: ContentType, hits: readonly RawHit[]): Promise<SearchHit[]> {
  if (hits.length === 0) return [];
  const rows = await catalogRepo.getMany(
    type,
    hits.map((h) => h.key),
  );
  const byKey = new Map<string, CatalogItemByType[ContentType]>(rows.map((r) => [r.key, r]));
  const categoryKeys = [...new Set(hits.flatMap((h) => (h.categoryKey ? [h.categoryKey] : [])))];
  const categories = new Map(
    (await Promise.all(categoryKeys.map((k) => catalogRepo.getCategory(k)))).flatMap((c) =>
      c ? [[c.key, c] as const] : [],
    ),
  );
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const row = byKey.get(hit.key);
    if (!row) continue;
    const result: SearchHit = { key: row.key, type, externalId: row.externalId, name: row.name };
    const category = hit.categoryKey ? categories.get(hit.categoryKey) : undefined;
    if (category) {
      result.categoryId = category.externalId;
      result.categoryName = category.name;
    }
    if (row.type === 'live' && row.number !== undefined) result.number = row.number;
    if (row.type !== 'live' && row.year !== undefined) result.year = row.year;
    out.push(result);
  }
  return out;
}

/** Runs a query against the index of `sourceId` (loading or building it first if needed). */
export async function searchCatalog(input: SearchQueryInput): Promise<SearchQueryResult> {
  const sourceId = typeof input?.sourceId === 'string' ? input.sourceId : '';
  const query = typeof input?.query === 'string' ? input.query.slice(0, 200) : '';
  const result: SearchQueryResult = { sourceId, query, groups: emptyGroups() };
  if (sourceId === '' || !isSearchableQuery(query)) return result;
  const found = await getIndex(sourceId);
  if (!found) return result;
  const types = Array.isArray(input.types)
    ? CONTENT_TYPES.filter((t) => input.types?.includes(t))
    : CONTENT_TYPES;
  const raw = querySearchIndex(found.loaded.index, sourceId, query, {
    types,
    limit: clampLimit(input.limit),
  });
  await Promise.all(
    CONTENT_TYPES.map(async (type) => {
      const hits = await hydrate(type, raw[type].hits);
      // Rows missing from the catalogue (index older than a write) do not count.
      const missing = raw[type].hits.length - hits.length;
      result.groups[type] = { total: raw[type].total - missing, hits };
    }),
  );
  return result;
}

/** Tests only: forgets the in-memory index (as after a worker restart). */
export function resetSearchCacheForTests(): void {
  cached = undefined;
  builds.clear();
}
