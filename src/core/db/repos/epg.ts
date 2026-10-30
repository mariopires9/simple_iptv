// XMLTV programme guide repository (EPG-02/EPG-03), table `epgPrograms`
// (`[channelEpgId+start]`, indexes `end`, `sourceId`). For XMLTV imports `channelEpgId` is the
// matched app channel's item key, so a channel's guide is one range read on the primary key.
import { getDb } from '../database';
import { BULK_CHUNK_SIZE } from './catalog';
import type { EpgProgram } from '../types';

/** Longest programme considered when looking back for the one on air. */
export const MAX_PROGRAMME_MS = 24 * 60 * 60 * 1000;

export const epgRepo = {
  /**
   * Replaces every programme of the source in one rw transaction, only if the source still
   * exists (checked inside it). Returns whether it was written.
   */
  async replaceForExistingSource(sourceId: string, programmes: readonly EpgProgram[]) {
    const db = await getDb();
    return db.transaction('rw', [db.sources, db.epgPrograms], async () => {
      if ((await db.sources.get(sourceId)) === undefined) return false;
      await db.epgPrograms.where('sourceId').equals(sourceId).delete();
      for (let i = 0; i < programmes.length; i += BULK_CHUNK_SIZE) {
        await db.epgPrograms.bulkPut(programmes.slice(i, i + BULK_CHUNK_SIZE));
      }
      return true;
    });
  },

  /** Adds programmes of the source (a later batch of a streamed import), only if it exists. */
  async appendForExistingSource(sourceId: string, programmes: readonly EpgProgram[]) {
    const db = await getDb();
    return db.transaction('rw', [db.sources, db.epgPrograms], async () => {
      if ((await db.sources.get(sourceId)) === undefined) return false;
      for (let i = 0; i < programmes.length; i += BULK_CHUNK_SIZE) {
        await db.epgPrograms.bulkPut(programmes.slice(i, i + BULK_CHUNK_SIZE));
      }
      return true;
    });
  },

  /** Deletes every programme (any source) that ended before `before` (EPG-02 AC4). */
  async purgeEnded(before: number): Promise<number> {
    const db = await getDb();
    return db.epgPrograms.where('end').below(before).delete();
  },

  /**
   * Up to `limit` programmes of the channel not yet finished at `now` (the one on air first),
   * in start order.
   */
  async upcoming(channelEpgId: string, now: number, limit = 2): Promise<EpgProgram[]> {
    const db = await getDb();
    return db.epgPrograms
      .where('[channelEpgId+start]')
      .between([channelEpgId, now - MAX_PROGRAMME_MS], [channelEpgId, Infinity], true, true)
      .filter((p) => p.end > now)
      .limit(limit)
      .toArray();
  },

  /**
   * Programmes of the channel overlapping `[from, to)`, in start order, at most `limit`
   * (EPG-04 guide grid).
   */
  async between(
    channelEpgId: string,
    from: number,
    to: number,
    limit = 500,
  ): Promise<EpgProgram[]> {
    const db = await getDb();
    return db.epgPrograms
      .where('[channelEpgId+start]')
      .between([channelEpgId, from - MAX_PROGRAMME_MS], [channelEpgId, to], true, false)
      .filter((p) => p.end > from)
      .limit(limit)
      .toArray();
  },

  async countForSource(sourceId: string): Promise<number> {
    const db = await getDb();
    return db.epgPrograms.where('sourceId').equals(sourceId).count();
  },
};
