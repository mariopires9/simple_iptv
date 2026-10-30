// Scheduled catalogue refresh (SRC-07 AC5) on app open and when the connection returns (PWA-04
// AC2). `startBackgroundSyncIfDue` decides what is due (Xtream lists not synced for 24 h, active
// list first, one at a time, nothing while offline); each sync then runs through the "My lists"
// tracker (`startSourceSync`), so it shows the same progress as a manual Refresh — on its card
// and as the discreet indicator next to the top-bar list selector — and Remove/Refresh/Edit
// coordinate with it. Loaded on demand (src/app/App.tsx): never in the initial bundle.
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { isNetworkBlocked } from '@/core/net';
import { takeSourcesPendingSync } from '@/core/session';
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
  // Lists a backup import queued (EXP-01): nothing queued resolves at once.
  startImportedSyncs({ isOnline }).catch((error: unknown) => {
    log.warn('Imported lists could not be synced', { error });
  });
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

export interface ImportedSyncDeps {
  /** Default: the ids queued by a backup import (EXP-01, `@/core/session`). */
  takePending: () => string[];
  /** Default: the stored lists. */
  loadSources: () => Promise<readonly Source[]>;
  start: (source: Pick<Source, 'id' | 'kind'>) => Promise<SyncRun>;
  isOnline: () => boolean;
}

/**
 * First sync of the lists a backup import queued (EXP-01), one at a time through the tracker.
 * Xtream lists are left to the scheduled refresh (never synced = due); M3U-URL lists are started
 * here; local-file lists need the user to pick the file again. Offline: kept queued for later.
 * Resolves with the ids that were started.
 */
export async function startImportedSyncs(deps: Partial<ImportedSyncDeps> = {}): Promise<string[]> {
  const {
    takePending = takeSourcesPendingSync,
    loadSources = async () => (await import('@/core/db')).sourcesRepo.list(),
    start = (source) => startSourceSync(source),
    isOnline = defaultDeps.isOnline,
  } = deps;
  if (!isOnline()) return [];
  const pending = new Set(takePending());
  if (pending.size === 0) return [];
  const lists = (await loadSources()).filter((s) => pending.has(s.id) && s.kind === 'm3u-url');
  const started: string[] = [];
  for (const source of lists) {
    const run = await start({ id: source.id, kind: source.kind });
    if (run.dispatch !== 'started') continue;
    started.push(source.id);
    await run.done;
  }
  return started;
}
