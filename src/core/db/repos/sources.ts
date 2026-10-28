// IPTV sources repository, including cascading removal (FND-05 CA4).
import { getDb } from '../database';
import { sourcePrefix } from '../keys';
import type { Source } from '../types';

export const sourcesRepo = {
  /** All sources in creation order. */
  async list(): Promise<Source[]> {
    const db = await getDb();
    return db.sources.orderBy('createdAt').toArray();
  },

  async get(id: string): Promise<Source | undefined> {
    const db = await getDb();
    return db.sources.get(id);
  },

  /** Creates or replaces a source. */
  async put(source: Source): Promise<void> {
    const db = await getDb();
    await db.sources.put(source);
  },

  /** Updates fields of an existing source; returns `false` if it does not exist. */
  async update(id: string, changes: Partial<Omit<Source, 'id'>>): Promise<boolean> {
    const db = await getDb();
    return (await db.sources.update(id, changes)) > 0;
  },

  /**
   * Removes the source and every record with its `sourceId` in a single transaction:
   * catalog, categories, series details, favorites, history, EPG, search index,
   * vault secret (`secretRef`) and settings that point to it.
   */
  async remove(id: string): Promise<void> {
    const db = await getDb();
    const prefix = sourcePrefix(id);
    await db.transaction(
      'rw',
      [
        db.sources,
        db.secrets,
        db.categories,
        db.channels,
        db.movies,
        db.series,
        db.seriesDetails,
        db.favorites,
        db.history,
        db.epgPrograms,
        db.searchIndex,
        db.settings,
      ],
      async () => {
        const source = await db.sources.get(id);
        if (source?.secretRef !== undefined) await db.secrets.delete(source.secretRef);
        await Promise.all([
          // Primary-key ranges (`${sourceId}:…`) → native `deleteRange`.
          db.categories.where('key').startsWith(prefix).delete(),
          db.channels.where('key').startsWith(prefix).delete(),
          db.movies.where('key').startsWith(prefix).delete(),
          db.series.where('key').startsWith(prefix).delete(),
          db.seriesDetails.where('seriesKey').startsWith(prefix).delete(),
          db.favorites.where('itemKey').startsWith(prefix).delete(),
          db.history.where('itemKey').startsWith(prefix).delete(),
          db.epgPrograms.where('sourceId').equals(id).delete(),
          db.searchIndex.delete(id),
        ]);
        const active = await db.settings.get('activeSourceId');
        if (active?.value === id) await db.settings.delete('activeSourceId');
        const lastChannel = await db.settings.get('lastChannelKey');
        if (typeof lastChannel?.value === 'string' && lastChannel.value.startsWith(prefix)) {
          await db.settings.delete('lastChannelKey');
        }
        await db.sources.delete(id);
      },
    );
  },
};
