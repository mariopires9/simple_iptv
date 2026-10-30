// Watch history and progress repository ("Continue watching").
import { getDb } from '../database';
import { parseItemKey } from '../keys';
import {
  CONTENT_TYPES,
  type CatalogItemByType,
  type ContentType,
  type HistoryEntry,
  type HistoryUpsert,
} from '../types';
import { catalogRepo } from './catalog';

/** A history entry with its catalogue item (see `historyRepo.listRecentItems`). */
export interface RecentItem<T extends ContentType> {
  entry: HistoryEntry;
  item: CatalogItemByType[T];
}

export interface RecentItemsOptions {
  /** How many available items to return. */
  limit: number;
  /** Only entries this accepts count (e.g. "has progress to resume"). */
  accept?: (entry: HistoryEntry) => boolean;
  /** Entries read per page (default 50). */
  pageSize?: number;
  /** Upper bound of entries read in total (default 1 000), so a long history stays cheap. */
  maxScanned?: number;
}

export interface RecentItemsResult<T extends ContentType> {
  items: RecentItem<T>[];
  /** History entries read (0: the source has no history of these types). */
  scanned: number;
}
export const historyRepo = {
  /**
   * Creates or updates the item's entry (one per item). Omitted fields keep the stored value;
   * `lastWatchedAt` is always updated (defaults to `Date.now()`).
   */
  async upsert(entry: HistoryUpsert): Promise<HistoryEntry> {
    const parsed = parseItemKey(entry.itemKey);
    if (!parsed) throw new TypeError(`Invalid item key: "${entry.itemKey}"`);
    const db = await getDb();
    return db.transaction('rw', db.history, async () => {
      const existing = await db.history.get(entry.itemKey);
      const record: HistoryEntry = {
        ...existing,
        itemKey: entry.itemKey,
        sourceId: parsed.sourceId,
        type: parsed.type,
        lastWatchedAt: entry.lastWatchedAt ?? Date.now(),
        completed: entry.completed ?? existing?.completed ?? false,
        ...(entry.positionSec !== undefined ? { positionSec: entry.positionSec } : {}),
        ...(entry.durationSec !== undefined ? { durationSec: entry.durationSec } : {}),
        ...(entry.episodeKey !== undefined ? { episodeKey: entry.episodeKey } : {}),
      };
      await db.history.put(record);
      return record;
    });
  },

  /**
   * Writes the item's entry with exactly these fields (no merge with the stored one): an omitted
   * `positionSec`/`durationSec`/`episodeKey` is cleared. `completed` defaults to `false`.
   */
  async set(entry: HistoryUpsert): Promise<HistoryEntry> {
    const parsed = parseItemKey(entry.itemKey);
    if (!parsed) throw new TypeError(`Invalid item key: "${entry.itemKey}"`);
    const db = await getDb();
    const record: HistoryEntry = {
      itemKey: entry.itemKey,
      sourceId: parsed.sourceId,
      type: parsed.type,
      lastWatchedAt: entry.lastWatchedAt ?? Date.now(),
      completed: entry.completed ?? false,
      ...(entry.positionSec !== undefined ? { positionSec: entry.positionSec } : {}),
      ...(entry.durationSec !== undefined ? { durationSec: entry.durationSec } : {}),
      ...(entry.episodeKey !== undefined ? { episodeKey: entry.episodeKey } : {}),
    };
    await db.history.put(record);
    return record;
  },

  /**
   * Entries whose key starts with `prefix` (e.g. the episodes of one series,
   * `${seriesKey}:ep:`), read through the primary key: never the rest of the history.
   */
  async listByKeyPrefix(prefix: string): Promise<HistoryEntry[]> {
    if (prefix === '') throw new TypeError('Empty history key prefix');
    const db = await getDb();
    return db.history.where('itemKey').startsWith(prefix).toArray();
  },

  async get(itemKey: string): Promise<HistoryEntry | undefined> {
    const db = await getDb();
    return db.history.get(itemKey);
  },

  async remove(itemKey: string): Promise<void> {
    const db = await getDb();
    await db.history.delete(itemKey);
  },

  /**
   * Removes every history entry (recent channels and progress) of a source (FAV-02 AC3).
   * Favorites live in another table and are kept. Returns how many entries were removed.
   */
  async clearSource(sourceId: string): Promise<number> {
    const db = await getDb();
    return db.history
      .where('[sourceId+type]')
      .anyOf(CONTENT_TYPES.map((type) => [sourceId, type]))
      .delete();
  },

  /**
   * One page of a source's entries of these types, by descending `lastWatchedAt`. Walks the
   * `lastWatchedAt` index and stops once the page is full: never reads the whole history.
   */
  async listRecentPage(
    sourceId: string,
    types: readonly ContentType[],
    offset: number,
    limit: number,
  ): Promise<HistoryEntry[]> {
    const db = await getDb();
    return db.history
      .orderBy('lastWatchedAt')
      .reverse()
      .filter((entry) => entry.sourceId === sourceId && types.includes(entry.type))
      .offset(offset)
      .limit(limit)
      .toArray();
  },

  /**
   * The most recent entries of these types whose item is still in the catalogue (FAV-02: Home
   * "Recent channels" and "Continue watching", Live "Recent"), most recent first. Reads the
   * history page by page until `limit` available items are found, skipping entries whose item
   * left the list (re-sync) or that `accept` rejects, and never more than `maxScanned` entries.
   */
  async listRecentItems<T extends ContentType>(
    sourceId: string,
    types: readonly T[],
    { limit, accept, pageSize = 50, maxScanned = 1_000 }: RecentItemsOptions,
  ): Promise<RecentItemsResult<T>> {
    const items: RecentItem<T>[] = [];
    let scanned = 0;
    while (items.length < limit && scanned < maxScanned) {
      const size = Math.min(pageSize, maxScanned - scanned);
      const page = await historyRepo.listRecentPage(sourceId, types, scanned, size);
      scanned += page.length;
      const wanted = accept ? page.filter(accept) : page;
      const found = new Map<string, CatalogItemByType[T]>();
      for (const type of types) {
        const keys = wanted.filter((e) => e.type === type).map((e) => e.itemKey);
        if (keys.length === 0) continue;
        for (const item of await catalogRepo.getMany(type, keys)) found.set(item.key, item);
      }
      for (const entry of wanted) {
        const item = found.get(entry.itemKey);
        if (item && items.length < limit) items.push({ entry, item });
      }
      if (page.length < size) break;
    }
    return { items, scanned };
  },

  /** Entries of a source+type by descending `lastWatchedAt`. */
  async listRecent(sourceId: string, type: ContentType, limit = 20): Promise<HistoryEntry[]> {
    const db = await getDb();
    const list = await db.history.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, limit);
  },

  /** Every history entry of every source (EXP-01 export). */
  async listAll(): Promise<HistoryEntry[]> {
    const db = await getDb();
    return db.history.toArray();
  },

  /** Writes already-validated entries in one transaction (EXP-01 import). */
  async putMany(entries: readonly HistoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await getDb();
    await db.history.bulkPut([...entries]);
  },
};
