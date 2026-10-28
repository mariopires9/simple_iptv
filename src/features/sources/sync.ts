// Initial catalogue sync after a source is added (SRC-03 AC2 → SRC-07). Fire and forget: saving a
// source never waits for, or fails because of, the sync. The worker module is loaded on demand so
// Comlink and the worker client stay out of the initial bundle.
import { log } from '@/core/log';

/** `started`: the worker task was dispatched; `unavailable`: it could not be started. */
export type InitialSyncDispatch = 'started' | 'unavailable';

export type StartInitialSync = (sourceId: string) => Promise<InitialSyncDispatch>;

/**
 * Dispatches the first sync of a newly added source to the data worker and resolves as soon as
 * the task has been started (not when it finishes), so the UI only claims "loading" when it is.
 * Never rejects: a failure to start or a failed sync is logged (the source records the outcome in
 * `lastSyncStatus` and My lists offers a refresh).
 */
export const startInitialSync: StartInitialSync = async (sourceId) => {
  let task: Promise<unknown>;
  try {
    const { runTask } = await import('@/worker');
    task = runTask('syncXtream', { sourceId });
  } catch (error) {
    log.warn('Initial sync could not be started', { sourceId, error });
    return 'unavailable';
  }
  task.catch((error: unknown) => {
    log.warn('Initial sync failed', { sourceId, error });
  });
  return 'started';
};
