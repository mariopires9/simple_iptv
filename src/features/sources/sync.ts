// Initial catalogue sync after a source is added (SRC-03 AC2 → SRC-07). Fire and forget: saving a
// source never waits for, or fails because of, the sync.
//
// TODO(SRC-07): the `syncXtream` worker task and the `@/worker` composition root (ADR-016) are
// being finished on another branch. Until they are merged, `@/worker` may not exist, so it is
// located with `import.meta.glob` (an empty match instead of a build error) and typed locally.
// Once SRC-07 is merged, replace this with `const { runTask } = await import('@/worker')` and the
// real types (`import type { ... } from '@/worker'`).
import { log } from '@/core/log';

/** The slice of `@/worker` used here (structural, see the TODO above). */
interface WorkerModule {
  runTask?: (
    name: 'syncXtream',
    input: { sourceId: string },
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

const workerModules = import.meta.glob<WorkerModule>('@/worker/index.ts');

export type StartInitialSync = (sourceId: string) => Promise<void>;

/**
 * Starts the first sync of a newly added source in the data worker. Never rejects: a missing
 * worker module/task or a failed sync is logged (the source keeps `lastSyncStatus: 'never'` and
 * My lists offers a refresh).
 */
export const startInitialSync: StartInitialSync = async (sourceId) => {
  try {
    const load = Object.values(workerModules)[0];
    const worker = load ? await load() : undefined;
    if (typeof worker?.runTask !== 'function') {
      log.warn('Initial sync not started: the worker sync task is not available yet', {
        sourceId,
      });
      return;
    }
    await worker.runTask('syncXtream', { sourceId });
  } catch (error) {
    log.warn('Initial sync failed', { sourceId, error });
  }
};
