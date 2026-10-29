// Scheduled catalogue refresh (SRC-07 AC5) on app open and when the connection returns (PWA-04
// AC2). `startBackgroundSyncIfDue` decides what is due (Xtream lists not synced for 24 h, active
// list first, one at a time, nothing while offline); each sync then runs through the "My lists"
// tracker (`startSourceSync`), so it shows the same progress as a manual Refresh — on its card
// and as the discreet indicator next to the top-bar list selector — and Remove/Refresh/Edit
// coordinate with it. Loaded on demand (src/app/App.tsx): never in the initial bundle.
import { isNetworkBlocked } from '@/core/net';
import { startBackgroundSyncIfDue, type BackgroundSyncResult } from '@/worker';
import { startSourceSync, type SyncRun } from './sourceSync';

/** Thrown for a list the tracker did not start (already syncing, being removed): skipped. */
const SKIPPED = { kind: 'cancelled' } as const;

export interface DueSyncDeps {
  start: (source: { id: string; kind: 'xtream' }) => Promise<SyncRun>;
  isOnline: () => boolean;
  now?: number;
}

const defaultDeps: DueSyncDeps = {
  start: (source) => startSourceSync(source),
  isOnline: () => !isNetworkBlocked(),
};

/** Starts the due background syncs; resolves once it has decided which ones run. */
export function startDueSyncs(deps: Partial<DueSyncDeps> = {}): Promise<BackgroundSyncResult> {
  const { start, isOnline, now } = { ...defaultDeps, ...deps };
  return startBackgroundSyncIfDue({
    isOnline,
    ...(now !== undefined ? { now } : {}),
    // The tracker waits for the worker to stop after a cancel itself.
    waitIdle: () => Promise.resolve(),
    run: async (sourceId) => {
      const run = await start({ id: sourceId, kind: 'xtream' });
      if (run.dispatch === 'unavailable') throw run.error;
      if (run.dispatch !== 'started') throw SKIPPED;
      const outcome = await run.done;
      if (outcome.status === 'failed') throw outcome.error;
      if (outcome.status === 'cancelled') throw SKIPPED;
      return { status: outcome.status };
    },
  });
}
