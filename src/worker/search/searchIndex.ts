// Search index of one source (SCH-01, ADR-009): MiniSearch over the catalogue names, built and
// queried in the data worker. Pure module (no IndexedDB): see ./searchService.ts for storage.
//
// Documents are kept small, because the index of a 100k-item list is serialized into IndexedDB
// and parsed back on every app open:
// - `id` = `<type code>:<externalId>` (`l`/`m`/`s`); the item key is rebuilt with the source id,
//   so the source id is not repeated 100k times;
// - indexed fields: the name (normalized: lowercase, no diacritics) and, for channels, the number;
// - stored field `c`: the category's external id (the category key is rebuilt the same way);
// - stored field `p` (only on protected items — DRM/DASH, UX-07): `1`, so "Hide protected content"
//   filters before counting and limiting, and totals stay right.
// Nothing else is stored: stream URLs, logos and other fields never enter the index (they may
// carry credentials in M3U lists), and the UI reads names from the catalogue when it shows hits.
import MiniSearch, { type Options, type SearchOptions } from 'minisearch';
import {
  CONTENT_TYPES,
  categoryKey,
  isProtectedItem,
  isSearchableQuery,
  itemKey,
  parseCategoryKey,
  tokenizeSearchText,
  type CatalogItem,
  type ContentType,
} from '@/core/db';

/** Format of the serialized index; bump it when the options or the document shape change. */
export const SEARCH_INDEX_VERSION = 2;

/** Terms of at least this length also match with typos (fuzzy 0.2 ⇒ 1 edit for 5–7 letters). */
export const FUZZY_MIN_TERM_LENGTH = 5;

const TYPE_CODE: Record<ContentType, string> = { live: 'l', movie: 'm', series: 's' };
const TYPE_BY_CODE: Record<string, ContentType> = { l: 'live', m: 'movie', s: 'series' };

/** An indexed document (see the header for the encoding). */
export interface SearchDoc {
  id: string;
  name: string;
  /** Channel number, as text. */
  num?: string;
  /** Category external id. */
  c?: string;
  /** `1` when the item is protected content (DRM/DASH, UX-07); absent otherwise. */
  p?: 1;
}

/** One match, before the catalogue rows are read. */
export interface RawHit {
  key: string;
  type: ContentType;
  externalId: string;
  categoryKey?: string;
}

export interface RawGroup {
  /** Every match of this type. */
  total: number;
  /** The best `limit` matches, best first. */
  hits: RawHit[];
}

export type RawResults = Record<ContentType, RawGroup>;

const SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  fuzzy: (term) => (term.length >= FUZZY_MIN_TERM_LENGTH ? 0.2 : false),
  maxFuzzy: 2,
  combineWith: 'AND',
  // A number match ranks below a name match ("sport tv 2": "Sport TV 2" before channel nº 2).
  boost: { name: 1, num: 0.5 },
};

function indexOptions(): Options<SearchDoc> {
  return {
    idField: 'id',
    fields: ['name', 'num'],
    storeFields: ['c', 'p'],
    tokenize: tokenizeSearchText,
    // Terms are already normalized by the tokenizer.
    processTerm: (term) => term,
    searchOptions: SEARCH_OPTIONS,
  };
}

export type SearchIndex = MiniSearch<SearchDoc>;

export function createSearchIndex(): SearchIndex {
  return new MiniSearch<SearchDoc>(indexOptions());
}

/** The document of a catalogue item; `undefined` for an item without a searchable name. */
export function toSearchDoc(item: CatalogItem): SearchDoc | undefined {
  if (typeof item.name !== 'string' || tokenizeSearchText(item.name).length === 0) return undefined;
  const doc: SearchDoc = { id: `${TYPE_CODE[item.type]}:${item.externalId}`, name: item.name };
  if (item.type === 'live' && typeof item.number === 'number' && Number.isFinite(item.number)) {
    doc.num = String(item.number);
  }
  if (item.categoryKey !== undefined) {
    const category = parseCategoryKey(item.categoryKey);
    if (category) doc.c = category.externalId;
  }
  if (isProtectedItem(item)) doc.p = 1;
  return doc;
}

/** Builds the index of a source's items (every type). Items without a name are skipped. */
export function buildSearchIndex(items: Iterable<CatalogItem>): SearchIndex {
  const index = createSearchIndex();
  const docs: SearchDoc[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const doc = toSearchDoc(item);
    // Keys are unique per table; a repeated id would make MiniSearch throw.
    if (doc && !seen.has(doc.id)) {
      seen.add(doc.id);
      docs.push(doc);
    }
  }
  index.addAll(docs);
  return index;
}

export function serializeSearchIndex(index: SearchIndex): string {
  return JSON.stringify(index);
}

/** Parses a serialized index (throws on a corrupt or incompatible one). */
export function loadSearchIndex(data: string): SearchIndex {
  return MiniSearch.loadJSON<SearchDoc>(data, indexOptions());
}

function emptyResults(): RawResults {
  return {
    live: { total: 0, hits: [] },
    movie: { total: 0, hits: [] },
    series: { total: 0, hits: [] },
  };
}

export interface QueryOptions {
  /** Types to return (default all). */
  types?: readonly ContentType[];
  /** Hits kept per type (default 20). Totals count every match. */
  limit?: number;
  /** Leave protected items (DRM/DASH, UX-07) out of hits and totals. */
  hideProtected?: boolean;
  /** Category keys whose items are left out of hits and totals (parental control, SEC-03). */
  excludeCategoryKeys?: readonly string[];
}

/**
 * Runs `query` against the index of `sourceId`: prefix match on every term, fuzzy (fraction 0.2)
 * on terms of ≥ 5 letters, all terms required. Results are grouped by type, best first.
 */
export function querySearchIndex(
  index: SearchIndex,
  sourceId: string,
  query: string,
  {
    types = CONTENT_TYPES,
    limit = 20,
    hideProtected = false,
    excludeCategoryKeys = [],
  }: QueryOptions = {},
): RawResults {
  const excluded = new Set(excludeCategoryKeys);
  const results = emptyResults();
  if (!isSearchableQuery(query)) return results;
  const wanted = new Set(types);
  const max = Math.max(0, Math.floor(limit));
  for (const match of index.search(query)) {
    const id = String(match.id);
    const separator = id.indexOf(':');
    const type = TYPE_BY_CODE[id.slice(0, separator)];
    if (type === undefined || !wanted.has(type)) continue;
    if (hideProtected && (match as { p?: unknown }).p === 1) continue;
    const c = (match as { c?: unknown }).c;
    const category = typeof c === 'string' && c !== '' ? categoryKey(sourceId, type, c) : undefined;
    if (category !== undefined && excluded.has(category)) continue;
    const group = results[type];
    group.total++;
    if (group.hits.length >= max) continue;
    const externalId = id.slice(separator + 1);
    const hit: RawHit = { key: itemKey(sourceId, type, externalId), type, externalId };
    if (category !== undefined) hit.categoryKey = category;
    group.hits.push(hit);
  }
  return results;
}
