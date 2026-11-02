// Storage breakdown and "Clear cached data" (STO-01): size estimates of what a list keeps on this
// device, and removal of the parts that can be fetched or rebuilt again.
//
// Estimates: row counts come from index counts (no row is read); bytes are the count times the
// average JSON size of a small sample of rows (the first ones of the index). The search index is
// one row per list whose `data` is already a string, so its length is used directly. These are
// approximations of what the browser stores (its own encoding and indexes differ): the UI labels
// them "about".
//
// What clearing touches (and never touches):
// - guide: every `epgPrograms` row and the lists' `epgStatus`, so the next guide update is due;
// - search: every `searchIndex` row (rebuilt by the worker on the next sync or first search);
// - catalogue of a list: its categories, channels, movies, series and series details, its search
//   index, and its sync state (`lastSyncAt`, status, per-type outcome, stats), so the app shows it
//   as never synced and the scheduled / manual sync refills it.
// Never: the `sources` rows themselves, `secrets`/`keys` (vault, proxy token), `settings`,
// `favorites` and `history` (they reference stable item keys, valid again after the re-sync).
import type { Collection } from 'dexie';
import { getDb } from '../database';
import { sourcePrefix } from '../keys';
import type { Source } from '../types';

/** Rows read per table to estimate the average row size. */
export const SIZE_SAMPLE_ROWS = 32;

export interface PartEstimate {
  rows: number;
  /** Approximate bytes (see the header). */
  bytes: number;
}

export interface SourceStorageEstimate {
  sourceId: string;
  catalogue: {
    live: number;
    movie: number;
    series: number;
    /** Series details (seasons and episodes) rows. */
    episodes: number;
    bytes: number;
  };
  search: PartEstimate;
  guide: PartEstimate;
}

/** JSON size of a value (UTF-16 code units, close to bytes for the mostly ASCII catalogue). */
export function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function estimateBytes(count: number, sample: readonly unknown[]): number {
  if (count === 0 || sample.length === 0) return 0;
  let total = 0;
  for (const row of sample) total += jsonSize(row);
  return Math.round((total / sample.length) * count);
}

/** Thrown between steps when the estimate's signal aborts. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export interface EstimateOptions {
  signal?: AbortSignal;
  /** Awaited between reads so a long estimate never holds the main thread (idle chunks). */
  pause?: () => Promise<void>;
}

const sourceSyncReset = (source: Source): Source => {
  const next: Source = {
    ...source,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
  };
  delete next.lastSyncAt;
  delete next.lastSyncError;
  delete next.lastSyncByType;
  delete next.protectedCounts;
  return next;
};

export const storageRepo = {
  /** Size estimate of one list's catalogue, search index and guide. */
  async estimateSource(
    sourceId: string,
    { signal, pause = () => Promise.resolve() }: EstimateOptions = {},
  ): Promise<SourceStorageEstimate> {
    const db = await getDb();
    const prefix = sourcePrefix(sourceId);
    const step = async <T>(read: () => Promise<T>): Promise<T> => {
      throwIfAborted(signal);
      await pause();
      throwIfAborted(signal);
      return read();
    };
    /** Count + sample of one query (re-created per read: a Dexie collection is single-use). */
    const part = async (query: () => Collection<unknown, unknown>): Promise<PartEstimate> => {
      const rows = await step(() => query().count());
      const sample = rows > 0 ? await step(() => query().limit(SIZE_SAMPLE_ROWS).toArray()) : [];
      return { rows, bytes: estimateBytes(rows, sample) };
    };

    const categories = await part(() => db.categories.where('sourceId').equals(sourceId));
    const live = await part(() => db.channels.where('sourceId').equals(sourceId));
    const movie = await part(() => db.movies.where('sourceId').equals(sourceId));
    const series = await part(() => db.series.where('sourceId').equals(sourceId));
    const details = await part(() => db.seriesDetails.where('seriesKey').startsWith(prefix));
    const guide = await part(() => db.epgPrograms.where('sourceId').equals(sourceId));
    const index = await step(() => db.searchIndex.get(sourceId));
    throwIfAborted(signal);
    return {
      sourceId,
      catalogue: {
        live: live.rows,
        movie: movie.rows,
        series: series.rows,
        episodes: details.rows,
        bytes: categories.bytes + live.bytes + movie.bytes + series.bytes + details.bytes,
      },
      search: index ? { rows: 1, bytes: index.data.length + 64 } : { rows: 0, bytes: 0 },
      guide,
    };
  },

  /** Removes every guide programme and forgets each list's guide status (the next update is due). */
  async clearGuide(): Promise<void> {
    const db = await getDb();
    await db.transaction('rw', [db.sources, db.epgPrograms], async () => {
      await db.epgPrograms.clear();
      await db.sources.toCollection().modify((source) => {
        delete source.epgStatus;
      });
    });
  },

  /** Removes every stored search index (rebuilt on the next sync or the first search). */
  async clearSearchIndexes(): Promise<void> {
    const db = await getDb();
    await db.searchIndex.clear();
  },

  /**
   * Removes the catalogue of these lists and resets their sync state (one transaction per list).
   * Returns the ids of the lists that exist (and were cleared).
   */
  async clearCatalogue(sourceIds: readonly string[]): Promise<string[]> {
    const db = await getDb();
    const cleared: string[] = [];
    for (const id of sourceIds) {
      const prefix = sourcePrefix(id);
      const done = await db.transaction(
        'rw',
        [
          db.sources,
          db.categories,
          db.channels,
          db.movies,
          db.series,
          db.seriesDetails,
          db.searchIndex,
        ],
        async () => {
          const source = await db.sources.get(id);
          if (!source) return false;
          await Promise.all([
            db.categories.where('key').startsWith(prefix).delete(),
            db.channels.where('key').startsWith(prefix).delete(),
            db.movies.where('key').startsWith(prefix).delete(),
            db.series.where('key').startsWith(prefix).delete(),
            db.seriesDetails.where('seriesKey').startsWith(prefix).delete(),
            db.searchIndex.delete(id),
          ]);
          await db.sources.put(sourceSyncReset(source));
          return true;
        },
      );
      if (done) cleared.push(id);
    }
    return cleared;
  },
};
