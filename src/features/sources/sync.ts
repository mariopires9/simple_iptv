// Initial catalogue sync after a source is added (SRC-03 AC2 → SRC-07). Fire and forget: saving a
// source never waits for, or fails because of, the sync. It runs through the shared sync tracker
// (SRC-08), so "My lists" shows its progress and offers to cancel it.
import { log } from '@/core/log';
import { startSourceSync } from './sourceSync';

/**
 * `started`: the worker task was dispatched; `unavailable`: it could not be started; `busy`: a
 * sync of this list was already running (or the list is being removed), so none was started.
 */
export type InitialSyncDispatch = 'started' | 'unavailable' | 'busy';

export type StartInitialSync = (sourceId: string) => Promise<InitialSyncDispatch>;

/**
 * Dispatches a sync of an Xtream source (first sync after adding it, or after its server or
 * credentials changed) to the data worker and resolves as soon as the task has been started (not
 * when it finishes), so the UI only claims "loading" when it is. Never rejects: a failure to
 * start or a failed sync is logged (the source records the outcome in `lastSyncStatus` and My
 * lists offers a refresh).
 */
export const startInitialSync: StartInitialSync = async (sourceId) => {
  const run = await startSourceSync({ id: sourceId, kind: 'xtream' });
  switch (run.dispatch) {
    case 'started':
      void run.done.then((outcome) => {
        if (outcome.status === 'failed') {
          log.warn('Initial sync failed', { sourceId, error: outcome.error });
        }
      });
      return 'started';
    case 'unavailable':
      log.warn('Initial sync could not be started', { sourceId, error: run.error });
      return 'unavailable';
    default:
      return 'busy';
  }
};
