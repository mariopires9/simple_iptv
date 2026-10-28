// Repositório do histórico de visualização e progresso ("Continuar a ver").
import { getDb } from '../database';
import { parseItemKey } from '../keys';
import type { ContentType, HistoryEntry, HistoryUpsert } from '../types';

export const historyRepo = {
  /**
   * Cria ou atualiza a entrada do item (uma por item). Os campos omitidos mantêm o valor guardado;
   * `lastWatchedAt` é sempre atualizado (por omissão `Date.now()`).
   */
  async upsert(entry: HistoryUpsert): Promise<HistoryEntry> {
    const parsed = parseItemKey(entry.itemKey);
    if (!parsed) throw new TypeError(`Chave de item inválida: "${entry.itemKey}"`);
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

  /** Entradas de uma fonte+tipo por `lastWatchedAt` descendente. */
  async listRecent(sourceId: string, type: ContentType, limit = 20): Promise<HistoryEntry[]> {
    const db = await getDb();
    const list = await db.history.where('[sourceId+type]').equals([sourceId, type]).toArray();
    return list.sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, limit);
  },
};
