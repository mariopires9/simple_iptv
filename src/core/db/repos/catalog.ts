// Catalog repository: categories, channels, movies, series, series details and search index.
import { getDb } from '../database';
import { categoryKey, itemKey, normalizeName, parseCategoryKey, typePrefix } from '../keys';
import { Dexie, type Collection, type Table } from 'dexie';
import type { SimpleIptvDb } from '../schema';
import type {
  CatalogItemByType,
  CatalogReplacement,
  Category,
  ContentType,
  SearchIndexEntry,
  SeriesDetails,
} from '../types';

/** Size of each `bulkPut` inside the transaction (limits memory spikes). */
export const BULK_CHUNK_SIZE = 5_000;

type CatalogTableName = 'channels' | 'movies' | 'series';

const TABLE_BY_TYPE: Record<ContentType, CatalogTableName> = {
  live: 'channels',
  movie: 'movies',
  series: 'series',
};

/** Table for the requested type (internal to core/db; features never call `db.table()`). */
function itemTable<T extends ContentType>(
  db: SimpleIptvDb,
  type: T,
): Table<CatalogItemByType[T], string> {
  return db.table<CatalogItemByType[T], string>(TABLE_BY_TYPE[type]);
}

/** All items of a category, sorted by `order` (index `[categoryKey+order]`). */
function categoryRange<T extends CatalogItemByType[ContentType]>(
  table: Table<T, string>,
  catKey: string,
): Collection<T, string> {
  return table
    .where('[categoryKey+order]')
    .between([catKey, Dexie.minKey], [catKey, Dexie.maxKey], true, true);
}

export interface PageOptions {
  offset?: number;
  limit?: number;
}

export interface ReplaceResult {
  /** Categories actually written (after removing duplicate keys). */
  categories: number;
  /** Items actually written (after removing duplicate keys). */
  items: number;
  /** Items dropped because a later item has the same key (the last one wins). */
  duplicates: number;
}

function byOrder(a: { order: number }, b: { order: number }): number {
  return a.order - b.order;
}

/** Removes repeated keys keeping the last record (same semantics as successive `bulkPut`s). */
function dedupeByKey<R extends { key: string }>(records: R[]): R[] {
  const byKey = new Map<string, R>();
  for (const r of records) {
    byKey.delete(r.key);
    byKey.set(r.key, r);
  }
  return byKey.size === records.length ? records : [...byKey.values()];
}

function buildItems<T extends ContentType>(
  sourceId: string,
  type: T,
  data: CatalogReplacement<T>,
): CatalogItemByType[T][] {
  return data.items.map((input, order) => {
    const { categoryExternalId, ...rest } = input;
    const record: Record<string, unknown> = {
      ...rest,
      key: itemKey(sourceId, type, input.externalId),
      sourceId,
      type,
      order,
    };
    if (categoryExternalId !== undefined && categoryExternalId !== '') {
      record.categoryKey = categoryKey(sourceId, type, categoryExternalId);
    }
    if (type === 'live') record.nameNorm = normalizeName(input.name);
    return record as unknown as CatalogItemByType[T];
  });
}

/** Records of one source+type, keyed and deduplicated, ready to be written. */
interface PreparedType<T extends ContentType> {
  type: T;
  categories: Category[];
  items: CatalogItemByType[T][];
  duplicates: number;
}

function prepare<T extends ContentType>(
  sourceId: string,
  type: T,
  data: CatalogReplacement<T>,
): PreparedType<T> {
  const categories: Category[] = dedupeByKey(
    data.categories.map((c, order) => ({
      key: categoryKey(sourceId, type, c.externalId),
      sourceId,
      type,
      externalId: c.externalId,
      name: c.name,
      order,
    })),
  );
  const allItems = buildItems(sourceId, type, data);
  const items = dedupeByKey(allItems);
  return { type, categories, items, duplicates: allItems.length - items.length };
}

/** Replaces one source+type; must run inside a rw transaction over categories + its table. */
async function writePrepared<T extends ContentType>(
  db: SimpleIptvDb,
  sourceId: string,
  prepared: PreparedType<T>,
): Promise<void> {
  const table = itemTable(db, prepared.type);
  // Delete by primary-key range (prefix `${sourceId}:${type}:`): Dexie turns it into a single
  // native `deleteRange`, much faster than walking a secondary index.
  const prefix = typePrefix(sourceId, prepared.type);
  await db.categories.where('key').startsWith(prefix).delete();
  await table.where('key').startsWith(prefix).delete();
  await db.categories.bulkPut(prepared.categories);
  for (let i = 0; i < prepared.items.length; i += BULK_CHUNK_SIZE) {
    await table.bulkPut(prepared.items.slice(i, i + BULK_CHUNK_SIZE));
  }
}

const resultOf = (p: PreparedType<ContentType>): ReplaceResult => ({
  categories: p.categories.length,
  items: p.items.length,
  duplicates: p.duplicates,
});

/**
 * Shared body of `replaceForSource` / `replaceForExistingSource`. With `requireSource`, the
 * existence check of the `sources` row runs inside the same rw transaction as the write, so a
 * concurrent `sourcesRepo.remove` (which also locks `sources` and the catalogue tables) either
 * happens entirely before (nothing is written) or entirely after (it deletes what was written).
 */
async function replace<T extends ContentType>(
  sourceId: string,
  type: T,
  data: CatalogReplacement<T>,
  requireSource: boolean,
): Promise<ReplaceResult | undefined> {
  const prepared = prepare(sourceId, type, data);
  const db = await getDb();
  const table = itemTable(db, type);
  const written = await db.transaction('rw', [db.sources, db.categories, table], async () => {
    if (requireSource && (await db.sources.get(sourceId)) === undefined) return false;
    await writePrepared(db, sourceId, prepared);
    return true;
  });
  if (!written) return undefined;
  return resultOf(prepared);
}

/** One replacement per content type (`replaceAllForExistingSource`). */
export type CatalogReplacementByType = { [T in ContentType]: CatalogReplacement<T> };

export const catalogRepo = {
  /**
   * Replaces all categories and items of a source+type in a single transaction:
   * either everything is written or nothing changes. Other sources and types are untouched.
   */
  async replaceForSource<T extends ContentType>(
    sourceId: string,
    type: T,
    data: CatalogReplacement<T>,
  ): Promise<ReplaceResult> {
    return (await replace(sourceId, type, data, false)) as ReplaceResult;
  },

  /**
   * Like `replaceForSource`, but only if the `sources` row still exists, checked atomically in
   * the same transaction. Returns `undefined` (and writes nothing) when the source is gone — e.g.
   * removed by the user while a sync was downloading — so no orphan rows are left behind.
   */
  async replaceForExistingSource<T extends ContentType>(
    sourceId: string,
    type: T,
    data: CatalogReplacement<T>,
  ): Promise<ReplaceResult | undefined> {
    return replace(sourceId, type, data, true);
  },

  /**
   * Replaces the live, movie and series catalogue of a source in ONE transaction (with the
   * existence check of the `sources` row), e.g. an M3U list, which is a single document: either
   * all three types are written or nothing changes (storage failure, source removed meanwhile).
   * Returns `undefined` (nothing written) when the source no longer exists.
   */
  async replaceAllForExistingSource(
    sourceId: string,
    data: CatalogReplacementByType,
  ): Promise<Record<ContentType, ReplaceResult> | undefined> {
    const prepared = {
      live: prepare(sourceId, 'live', data.live),
      movie: prepare(sourceId, 'movie', data.movie),
      series: prepare(sourceId, 'series', data.series),
    };
    const db = await getDb();
    const written = await db.transaction(
      'rw',
      [db.sources, db.categories, db.channels, db.movies, db.series],
      async () => {
        if ((await db.sources.get(sourceId)) === undefined) return false;
        await writePrepared(db, sourceId, prepared.live);
        await writePrepared(db, sourceId, prepared.movie);
        await writePrepared(db, sourceId, prepared.series);
        return true;
      },
    );
    if (!written) return undefined;
    return {
      live: resultOf(prepared.live),
      movie: resultOf(prepared.movie),
      series: resultOf(prepared.series),
    };
  },

  /** Categories of a source+type in the source's original order. */
  async listCategories(sourceId: string, type: ContentType): Promise<Category[]> {
    const db = await getDb();
    const list = await db.categories.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort(byOrder);
  },

  /**
   * Items of a category in the source's original order. Uses the `[categoryKey+order]` index,
   * so only the requested page is read from IndexedDB.
   */
  async listByCategory<T extends ContentType>(
    type: T,
    catKey: string,
    { offset = 0, limit }: PageOptions = {},
  ): Promise<CatalogItemByType[T][]> {
    const parsed = parseCategoryKey(catKey);
    if (!parsed || parsed.type !== type) return [];
    const db = await getDb();
    let query = categoryRange(itemTable(db, type), catKey).offset(offset);
    if (limit !== undefined) query = query.limit(limit);
    return query.toArray();
  },

  /** Number of items in a category. */
  async countByCategory(type: ContentType, catKey: string): Promise<number> {
    const parsed = parseCategoryKey(catKey);
    if (!parsed || parsed.type !== type) return 0;
    const db = await getDb();
    return categoryRange(itemTable(db, type), catKey).count();
  },

  /** Number of items of a source+type. */
  async count(sourceId: string, type: ContentType): Promise<number> {
    const db = await getDb();
    return itemTable(db, type).where('sourceId').equals(sourceId).count();
  },

  async get<T extends ContentType>(
    type: T,
    key: string,
  ): Promise<CatalogItemByType[T] | undefined> {
    const db = await getDb();
    return itemTable(db, type).get(key);
  },

  /** Several items by key (e.g. favorites); missing keys are omitted, order is preserved. */
  async getMany<T extends ContentType>(
    type: T,
    keys: readonly string[],
  ): Promise<CatalogItemByType[T][]> {
    const db = await getDb();
    const found = await itemTable(db, type).bulkGet([...keys]);
    return found.filter((x): x is CatalogItemByType[T] => x !== undefined);
  },

  async getCategory(key: string): Promise<Category | undefined> {
    const db = await getDb();
    return db.categories.get(key);
  },

  async getSeriesDetails(seriesKey: string): Promise<SeriesDetails | undefined> {
    const db = await getDb();
    return db.seriesDetails.get(seriesKey);
  },

  /** Cached details of several series in one read, aligned with `seriesKeys` (missing → undefined). */
  async getSeriesDetailsMany(
    seriesKeys: readonly string[],
  ): Promise<(SeriesDetails | undefined)[]> {
    if (seriesKeys.length === 0) return [];
    const db = await getDb();
    return db.seriesDetails.bulkGet([...seriesKeys]);
  },

  async putSeriesDetails(details: SeriesDetails): Promise<void> {
    const db = await getDb();
    await db.seriesDetails.put(details);
  },

  async getSearchIndex(sourceId: string): Promise<SearchIndexEntry | undefined> {
    const db = await getDb();
    return db.searchIndex.get(sourceId);
  },

  async putSearchIndex(entry: SearchIndexEntry): Promise<void> {
    const db = await getDb();
    await db.searchIndex.put(entry);
  },

  /**
   * Like `putSearchIndex`, but only if the `sources` row still exists, checked in the same rw
   * transaction (SCH-01): an index built while the source was being removed is not left behind.
   * Returns whether it was written.
   */
  async putSearchIndexForExistingSource(entry: SearchIndexEntry): Promise<boolean> {
    const db = await getDb();
    return db.transaction('rw', [db.sources, db.searchIndex], async () => {
      if ((await db.sources.get(entry.sourceId)) === undefined) return false;
      await db.searchIndex.put(entry);
      return true;
    });
  },

  /**
   * Every item of a source+type (index `sourceId`), in no particular order. For whole-catalogue
   * work in the data worker (SCH-01 search index); screens page by category instead.
   */
  async listForSource<T extends ContentType>(
    sourceId: string,
    type: T,
  ): Promise<CatalogItemByType[T][]> {
    const db = await getDb();
    return itemTable(db, type).where('sourceId').equals(sourceId).toArray();
  },

  /**
   * Position (0-based) an item with `order` has in its category: the number of items of the
   * category before it in the original order. One count over the `[categoryKey+order]` index
   * (LIV-02: locating the playing channel for zapping), never a scan.
   */
  async indexInCategory(type: ContentType, catKey: string, order: number): Promise<number> {
    const parsed = parseCategoryKey(catKey);
    if (!parsed || parsed.type !== type) return 0;
    const db = await getDb();
    return itemTable(db, type)
      .where('[categoryKey+order]')
      .between([catKey, Dexie.minKey], [catKey, order], true, false)
      .count();
  },
};
