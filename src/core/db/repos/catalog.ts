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

    const db = await getDb();
    const table = itemTable(db, type);
    await db.transaction('rw', db.categories, table, async () => {
      // Delete by primary-key range (prefix `${sourceId}:${type}:`): Dexie turns it into a single
      // native `deleteRange`, much faster than walking a secondary index.
      const prefix = typePrefix(sourceId, type);
      await db.categories.where('key').startsWith(prefix).delete();
      await table.where('key').startsWith(prefix).delete();
      await db.categories.bulkPut(categories);
      for (let i = 0; i < items.length; i += BULK_CHUNK_SIZE) {
        await table.bulkPut(items.slice(i, i + BULK_CHUNK_SIZE));
      }
    });
    return {
      categories: categories.length,
      items: items.length,
      duplicates: allItems.length - items.length,
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
};
