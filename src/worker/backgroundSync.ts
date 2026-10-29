// Automatic catalogue refresh on app open (SRC-07 AC5, ARCHITECTURE.md §7): when a source's
// `lastSyncAt` is older than the max age (24 h by default, configurable) and the device is online,
// a background sync runs in the data worker. The UI indicator is a separate story.
// Dexie is loaded lazily (dynamic import below) so importing `@/worker` keeps it out of the
// initial chunk (ADR-003 budget, FND-04).
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import type { SyncXtreamResult } from '@/providers/xtream';
import { runTask } from './client';
import type { RunTaskOptions } from '@/core/worker';

export const DEFAULT_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a source should be refreshed automatically. Pure.
 * - Only Xtream sources (M3U files cannot be refreshed without the user; M3U URLs come later).
 * - Never synced → due. Older than `maxAgeMs` → due. A `lastSyncAt` in the future (clock moved
 *   back) → due, so a wrong clock cannot block refreshes forever.
 * - An invalid `maxAgeMs` (not a finite positive number) falls back to the default.
 */
export function isSyncDue(
  source: Pick<Source, 'kind' | 'lastSyncAt'>,
  now: number,
  maxAgeMs: number = DEFAULT_SYNC_MAX_AGE_MS,
): boolean {
  if (source.kind !== 'xtream') return false;
  const maxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_SYNC_MAX_AGE_MS;
  const last = source.lastSyncAt;
  if (last === undefined || !Number.isFinite(last)) return true;
  const age = now - last;
  return age < 0 || age >= maxAge;
}

export interface BackgroundSyncOptions {
  /** Default `Date.now()`. */
  now?: number;
  /** Default {@link DEFAULT_SYNC_MAX_AGE_MS}. */
  maxAgeMs?: number;
  /** Default `navigator.onLine` (true when unknown). */
  isOnline?: () => boolean;
  /**
   * Runs one sync; default: the `syncXtream` worker task. Only `status` is read, so a caller can
   * route the sync through its own tracker (e.g. "My lists" progress, SRC-07 AC5 indicator).
   */
  run?: (sourceId: string, options: RunTaskOptions) => Promise<Pick<SyncXtreamResult, 'status'>>;
  /** Progress of the sync currently running (for a discreet indicator). */
  onProgress?: RunTaskOptions['onProgress'];
  /** Cancels the remaining background syncs. */
  signal?: AbortSignal;
  /**
   * Resolves when the worker has really finished with a source. A client-side abort rejects at
   * once while the worker may still be stopping, so a cancelled source stays "in flight" until
   * this settles. Default: the `waitSyncIdle` worker task.
   */
  waitIdle?: (sourceId: string) => Promise<unknown>;
}

export interface BackgroundSyncOutcome {
  sourceId: string;
  status: SyncXtreamResult['status'] | 'failed' | 'cancelled';
}

export interface BackgroundSyncResult {
  /** Sources whose sync was started, in order (the active source first). */
  started: string[];
  /** Resolves when every started sync has settled; never rejects. */
  done: Promise<BackgroundSyncOutcome[]>;
}

/** Sources with a background sync in flight (prevents duplicates on repeated calls). */
const inFlight = new Set<string>();

function defaultIsOnline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  return nav?.onLine !== false;
}

const defaultRun: NonNullable<BackgroundSyncOptions['run']> = (sourceId, options) =>
  runTask('syncXtream', { sourceId }, options);

const defaultWaitIdle: NonNullable<BackgroundSyncOptions['waitIdle']> = (sourceId) =>
  runTask('waitSyncIdle', { sourceId });

/**
 * Starts a background sync for every due Xtream source (active source first), one at a time so
 * only one large catalogue is in memory. Returns immediately after deciding what to start.
 */
export async function startBackgroundSyncIfDue(
  options: BackgroundSyncOptions = {},
): Promise<BackgroundSyncResult> {
  const {
    maxAgeMs,
    isOnline = defaultIsOnline,
    run = defaultRun,
    waitIdle = defaultWaitIdle,
    onProgress,
    signal,
  } = options;
  const now = options.now ?? Date.now();
  if (!isOnline() || signal?.aborted) return { started: [], done: Promise.resolve([]) };

  const { settingsRepo, sourcesRepo } = await import('@/core/db');
  const [sources, activeId] = await Promise.all([
    sourcesRepo.list(),
    settingsRepo.get('activeSourceId'),
  ]);
  const due = sources
    .filter((s) => !inFlight.has(s.id) && isSyncDue(s, now, maxAgeMs))
    .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
  const started = due.map((s) => s.id);
  for (const id of started) inFlight.add(id);

  const done = (async () => {
    const outcomes: BackgroundSyncOutcome[] = [];
    for (const sourceId of started) {
      try {
        if (signal?.aborted) {
          outcomes.push({ sourceId, status: 'cancelled' });
          continue;
        }
        const runOptions: RunTaskOptions = {};
        if (onProgress) runOptions.onProgress = onProgress;
        if (signal) runOptions.signal = signal;
        const result = await run(sourceId, runOptions);
        outcomes.push({ sourceId, status: result.status });
      } catch (err) {
        const cancelled = (err as { kind?: unknown } | null)?.kind === 'cancelled';
        outcomes.push({ sourceId, status: cancelled ? 'cancelled' : 'failed' });
        if (!cancelled) log.warn('background sync failed', { sourceId, error: err });
        // Stay in flight until the worker-side task has settled (the per-source queue in the
        // worker also serialises a restart, this just avoids queuing a duplicate).
        if (cancelled) {
          await Promise.resolve()
            .then(() => waitIdle(sourceId))
            .catch(() => undefined);
        }
      } finally {
        inFlight.delete(sourceId);
      }
    }
    return outcomes;
  })();
  return { started, done };
}
