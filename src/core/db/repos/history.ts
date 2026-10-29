// Watch history and progress repository ("Continue watching").
import { getDb } from '../database';
import { parseItemKey } from '../keys';
import { CONTENT_TYPES, type ContentType, type HistoryEntry, type HistoryUpsert } from '../types';

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

  /** Entries of a source+type by descending `lastWatchedAt`. */
  async listRecent(sourceId: string, type: ContentType, limit = 20): Promise<HistoryEntry[]> {
    const db = await getDb();
    const list = await db.history.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, limit);
  },
};
