// Favorites repository. The key is the item's composite key, so it survives re-syncs.
import { getDb } from '../database';
import { parseItemKey } from '../keys';
import type { ContentType, Favorite } from '../types';

function parseOrThrow(key: string) {
  const parsed = parseItemKey(key);
  if (!parsed) throw new TypeError(`Invalid item key: "${key}"`);
  return parsed;
}

export const favoritesRepo = {
  async add(itemKey: string, addedAt: number = Date.now()): Promise<void> {
    const { sourceId, type } = parseOrThrow(itemKey);
    const db = await getDb();
    await db.favorites.put({ itemKey, sourceId, type, addedAt });
  },

  async remove(itemKey: string): Promise<void> {
    const db = await getDb();
    await db.favorites.delete(itemKey);
  },

  async has(itemKey: string): Promise<boolean> {
    const db = await getDb();
    return (await db.favorites.get(itemKey)) !== undefined;
  },

  /** Toggles the favorite; returns the new state. */
  async toggle(itemKey: string): Promise<boolean> {
    const { sourceId, type } = parseOrThrow(itemKey);
    const db = await getDb();
    return db.transaction('rw', db.favorites, async () => {
      if (await db.favorites.get(itemKey)) {
        await db.favorites.delete(itemKey);
        return false;
      }
      await db.favorites.put({ itemKey, sourceId, type, addedAt: Date.now() });
      return true;
    });
  },

  /** Favorites of a source+type, most recent first. */
  async list(sourceId: string, type: ContentType): Promise<Favorite[]> {
    const db = await getDb();
    const list = await db.favorites.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort((a, b) => b.addedAt - a.addedAt);
  },
};
