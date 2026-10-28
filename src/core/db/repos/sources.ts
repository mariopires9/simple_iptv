// Repositório de fontes IPTV, incluindo a remoção em cascata (FND-05 CA4).
import { getDb } from '../database';
import { sourcePrefix } from '../keys';
import type { Source } from '../types';

export const sourcesRepo = {
  /** Todas as fontes pela ordem de criação. */
  async list(): Promise<Source[]> {
    const db = await getDb();
    return db.sources.orderBy('createdAt').toArray();
  },

  async get(id: string): Promise<Source | undefined> {
    const db = await getDb();
    return db.sources.get(id);
  },

  /** Cria ou substitui uma fonte. */
  async put(source: Source): Promise<void> {
    const db = await getDb();
    await db.sources.put(source);
  },

  /** Atualiza campos de uma fonte existente; devolve `false` se não existir. */
  async update(id: string, changes: Partial<Omit<Source, 'id'>>): Promise<boolean> {
    const db = await getDb();
    return (await db.sources.update(id, changes)) > 0;
  },

  /**
   * Remove a fonte e todos os registos com o seu `sourceId` numa única transação:
   * catálogo, categorias, detalhes de séries, favoritos, histórico, EPG, índice de pesquisa,
   * segredo do cofre (`secretRef`) e definições que apontem para ela.
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
          // Intervalos da chave primária (`${sourceId}:…`) → `deleteRange` nativo.
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
