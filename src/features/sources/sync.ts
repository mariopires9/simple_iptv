// Initial catalogue sync after a source is added (SRC-03 AC2 → SRC-07). Fire and forget: saving a
// source never waits for, or fails because of, the sync. The worker module is loaded on demand so
// Comlink and the worker client stay out of the initial bundle.
import { log } from '@/core/log';

export type StartInitialSync = (sourceId: string) => Promise<void>;

/**
 * Starts the first sync of a newly added source in the data worker. Never rejects: a failed sync
 * is logged (the source records the outcome in `lastSyncStatus` and My lists offers a refresh).
 */
export const startInitialSync: StartInitialSync = async (sourceId) => {
  try {
    const { runTask } = await import('@/worker');
    await runTask('syncXtream', { sourceId });
  } catch (error) {
    log.warn('Initial sync failed', { sourceId, error });
  }
};
