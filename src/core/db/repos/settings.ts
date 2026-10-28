// Settings repository: typed values per key (see `SettingsMap`).
import { getDb } from '../database';
import type { SettingsEntry, SettingsKey, SettingsMap } from '../types';

export const settingsRepo = {
  async get<K extends SettingsKey>(key: K): Promise<SettingsMap[K] | undefined> {
    const db = await getDb();
    const entry = (await db.settings.get(key)) as SettingsEntry<K> | undefined;
    return entry?.value;
  },

  async set<K extends SettingsKey>(key: K, value: SettingsMap[K]): Promise<void> {
    const db = await getDb();
    const entry: SettingsEntry<K> = { key, value };
    await db.settings.put(entry as SettingsEntry);
  },

  async remove(key: SettingsKey): Promise<void> {
    const db = await getDb();
    await db.settings.delete(key);
  },
};
