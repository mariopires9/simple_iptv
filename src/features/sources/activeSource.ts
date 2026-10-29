// Active list (SRC-08 AC4): the `activeSourceId` setting as a small reactive store, so switching
// lists re-renders every screen without a reload. `setActiveSource` persists first and then
// publishes, so whoever re-reads the setting after a change (e.g. the Live screen remounted by the
// app shell) sees the new value.
//
// Statically reachable from the app shell (initial bundle): `@/core/db` is imported dynamically.
import { useEffect, useSyncExternalStore } from 'react';

export interface ActiveSourceSnapshot {
  /** Stored `activeSourceId`; `undefined` when not set (screens then use the first list). */
  readonly id: string | undefined;
  /** Whether `id` has been read from (or written to) storage. */
  readonly known: boolean;
  /** Incremented every time the active list is changed through {@link setActiveSource}. */
  readonly changes: number;
}

const INITIAL: ActiveSourceSnapshot = { id: undefined, known: false, changes: 0 };

let snapshot: ActiveSourceSnapshot = INITIAL;
let loading: Promise<string | undefined> | undefined;
/** Bumped by every write: a read started before it must not overwrite the newer value. */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: ActiveSourceSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getActiveSourceSnapshot(): ActiveSourceSnapshot {
  return snapshot;
}

export function subscribeActiveSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the stored active list once; later calls answer from the cache. */
export function loadActiveSourceId(): Promise<string | undefined> {
  if (snapshot.known) return Promise.resolve(snapshot.id);
  if (loading) return loading;
  const startedAt = generation;
  const current = (async () => {
    const { settingsRepo } = await import('@/core/db');
    return settingsRepo.get('activeSourceId');
  })();
  loading = current;
  current.then(
    (id) => {
      if (loading === current) loading = undefined;
      if (startedAt === generation) publish({ id, known: true, changes: snapshot.changes });
    },
    () => {
      // Not cached: the next reader tries again.
      if (loading === current) loading = undefined;
    },
  );
  return current;
}

/**
 * Makes `id` the active list (`undefined` clears it): persisted to `settingsRepo`, then published
 * to every subscriber. Choosing the list that is already active is not a change.
 */
export async function setActiveSource(id: string | undefined): Promise<void> {
  const { settingsRepo } = await import('@/core/db');
  if (id === undefined) await settingsRepo.remove('activeSourceId');
  else await settingsRepo.set('activeSourceId', id);
  generation++;
  loading = undefined;
  const changed = !snapshot.known || snapshot.id !== id;
  publish({ id, known: true, changes: snapshot.changes + (changed ? 1 : 0) });
}

/** Forgets the cached value (after "delete all data", and in tests). Not counted as a change. */
export function forgetActiveSource(): void {
  generation++;
  loading = undefined;
  publish({ id: undefined, known: false, changes: snapshot.changes });
}

/** The whole snapshot (id, whether it is known yet); the first use triggers a read. */
export function useActiveSource(): ActiveSourceSnapshot {
  const current = useSyncExternalStore(subscribeActiveSource, getActiveSourceSnapshot);
  useEffect(() => {
    if (!current.known) loadActiveSourceId().catch(() => undefined);
  }, [current.known]);
  return current;
}

/** The stored active list id (`undefined` while loading or when not set). */
export function useActiveSourceId(): string | undefined {
  return useActiveSource().id;
}

/**
 * A counter that changes whenever the user switches the active list. Does not read storage:
 * screens that load "the active source" key their data on it to reload after a switch.
 */
export function useActiveSourceChanges(): number {
  return useSyncExternalStore(subscribeActiveSource, getActiveSourceSnapshot).changes;
}
