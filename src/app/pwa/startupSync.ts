// Scheduled catalogue refresh on app open (SRC-07 AC5): once the app is up and idle, the lists
// whose last sync is older than 24 h are refreshed in the background (features/sources/dueSync).
// The sync module and the data worker are only loaded then, never in the initial bundle.
import { log } from '@/core/log';

export type StartDueSyncs = () => Promise<unknown>;

const defaultStart: StartDueSyncs = async () => {
  const { startDueSyncs } = await import('@/features/sources/dueSync');
  return startDueSyncs();
};

/** Runs `callback` when the browser is idle (or after `fallbackMs`). Returns a cancel. */
export type ScheduleIdle = (callback: () => void) => () => void;

const IDLE_TIMEOUT_MS = 3_000;

/** Runs `callback` once the browser is idle (at most `IDLE_TIMEOUT_MS` later). */
export const scheduleIdle: ScheduleIdle = (callback) => {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => g.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(callback, IDLE_TIMEOUT_MS);
  return () => clearTimeout(timer);
};

let done = false;

/**
 * Schedules the start-up refresh once per app session (a re-mounted App, e.g. React StrictMode or
 * a language switch, does not start it again). Returns the cleanup (cancels if not yet run).
 */
export function scheduleStartupSync(
  start: StartDueSyncs = defaultStart,
  schedule: ScheduleIdle = scheduleIdle,
): () => void {
  if (done) return () => undefined;
  return schedule(() => {
    if (done) return;
    done = true;
    start().catch((error: unknown) => {
      log.warn('Start-up sync could not be started', { error });
    });
  });
}

/** Tests only. */
export function resetStartupSyncForTests(): void {
  done = false;
}
