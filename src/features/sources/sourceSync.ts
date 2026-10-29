// Catalogue syncs started from the UI (SRC-08 AC5 "Refresh", and the initial sync after adding a
// list): one per list at a time, with progress and cancellation, tracked here (module state) so a
// card shows its progress even after leaving and re-opening "My lists". The worker module is
// loaded on demand so Comlink and the worker client stay out of the initial bundle.
import { useSyncExternalStore } from 'react';
import type { Source } from '@/core/db';
import type { RunTaskOptions, TaskProgress } from '@/worker';
import { reloadSourcesIfLoaded } from './sourcesList';

export interface SourceSyncProgress {
  /** Worker phase name (e.g. `live`, `download`); `undefined` until the first progress. */
  readonly phase: string | undefined;
  readonly done: number | undefined;
  readonly total: number | undefined;
  /** Cancellation requested; the worker is stopping. */
  readonly cancelling: boolean;
}

export type SyncOutcome =
  | { status: 'ok' | 'partial' | 'error' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown };

/**
 * - `started`: the worker task was dispatched (`done` settles when it ends; it never rejects);
 * - `busy`: a sync of this list is already running;
 * - `unsupported`: this kind of list cannot be refreshed (local M3U file);
 * - `unavailable`: the task could not be started (`error` says why).
 */
export type SyncRun =
  | { dispatch: 'started'; done: Promise<SyncOutcome> }
  | { dispatch: 'busy' | 'unsupported' }
  | { dispatch: 'unavailable'; error: unknown };

/** The worker entry points used here (injectable in tests). */
export interface SyncWorker {
  runTask(
    name: 'syncXtream' | 'syncM3u',
    input: { sourceId: string },
    options: RunTaskOptions,
  ): Promise<{ status: 'ok' | 'partial' | 'error' }>;
  runTask(name: 'waitSyncIdle', input: { sourceId: string }): Promise<unknown>;
}

const loadWorker = async (): Promise<SyncWorker> => (await import('@/worker')) as SyncWorker;

interface Entry {
  progress: SourceSyncProgress;
  controller: AbortController;
  done: Promise<SyncOutcome> | undefined;
}

const entries = new Map<string, Entry>();
let snapshot: ReadonlyMap<string, SourceSyncProgress> = new Map();
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = new Map([...entries].map(([id, entry]) => [id, entry.progress]));
  for (const listener of listeners) listener();
}

function update(id: string, entry: Entry, progress: Partial<SourceSyncProgress>): void {
  if (entries.get(id) !== entry) return;
  entry.progress = { ...entry.progress, ...progress };
  publish();
}

export function getSourceSyncSnapshot(): ReadonlyMap<string, SourceSyncProgress> {
  return snapshot;
}

export function subscribeSourceSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSourceSyncRunning(sourceId: string): boolean {
  return entries.has(sourceId);
}

/** Progress of the sync of `sourceId`, or `undefined` when none is running. */
export function useSourceSync(sourceId: string): SourceSyncProgress | undefined {
  return useSyncExternalStore(subscribeSourceSync, getSourceSyncSnapshot).get(sourceId);
}

const isCancelled = (error: unknown) => (error as { kind?: unknown } | null)?.kind === 'cancelled';

/** Starts the sync task that fits the kind of list (`syncXtream` / `syncM3u`). */
export async function startSourceSync(
  source: Pick<Source, 'id' | 'kind'>,
  worker: () => Promise<SyncWorker> = loadWorker,
): Promise<SyncRun> {
  const { id, kind } = source;
  if (kind === 'm3u-file') return { dispatch: 'unsupported' };
  if (entries.has(id)) return { dispatch: 'busy' };
  // Registered before the first await, so a second click cannot start a duplicate.
  const entry: Entry = {
    progress: { phase: undefined, done: undefined, total: undefined, cancelling: false },
    controller: new AbortController(),
    done: undefined,
  };
  entries.set(id, entry);
  publish();

  const finish = () => {
    if (entries.get(id) === entry) {
      entries.delete(id);
      publish();
    }
    reloadSourcesIfLoaded();
  };

  let api: SyncWorker;
  let task: Promise<{ status: 'ok' | 'partial' | 'error' }>;
  try {
    api = await worker();
    const options: RunTaskOptions = {
      signal: entry.controller.signal,
      onProgress: (p: TaskProgress) =>
        update(id, entry, { phase: p.phase, done: p.done, total: p.total }),
    };
    task = api.runTask(kind === 'xtream' ? 'syncXtream' : 'syncM3u', { sourceId: id }, options);
  } catch (error) {
    finish();
    return { dispatch: 'unavailable', error };
  }

  entry.done = task.then(
    (result): SyncOutcome => ({ status: result.status }),
    async (error: unknown): Promise<SyncOutcome> => {
      if (!isCancelled(error)) return { status: 'failed', error };
      // The client rejects at once; stay "running" until the worker has really stopped, so a new
      // refresh (or a removal) does not overlap with it.
      await Promise.resolve()
        .then(() => api.runTask('waitSyncIdle', { sourceId: id }))
        .catch(() => undefined);
      return { status: 'cancelled' };
    },
  );
  void entry.done.finally(finish);
  return { dispatch: 'started', done: entry.done };
}

/** Requests cancellation of a running sync; resolves when it has stopped (no-op when idle). */
export async function cancelSourceSync(sourceId: string): Promise<void> {
  const entry = entries.get(sourceId);
  if (!entry) return;
  if (!entry.progress.cancelling) update(sourceId, entry, { cancelling: true });
  entry.controller.abort();
  await entry.done;
}

/** Tests only: forget every tracked sync. */
export function resetSourceSyncs(): void {
  entries.clear();
  publish();
}
