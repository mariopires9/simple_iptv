// "Does the user have at least one source?" — read once per session and cached for the onboarding
// guard (UX-01 AC1). Whoever adds or removes a source updates the cache (`setSourcesPresent`), so
// the guard answers synchronously on every navigation after the first read.
//
// The snapshot is an immutable object replaced on every change (with a version), so
// `useSyncExternalStore` subscribers always re-render — even when an invalidation publishes
// `undefined` again while a read is in flight — and can re-check.
//
// Statically reachable from the router (initial bundle): `@/core/db` is imported dynamically only.

export interface SourcesPresenceSnapshot {
  /** `undefined` until known (first read pending, or invalidated). */
  readonly present: boolean | undefined;
  /** Incremented on every change. */
  readonly version: number;
}

let snapshot: SourcesPresenceSnapshot = { present: undefined, version: 0 };
let loading: Promise<boolean> | undefined;
const listeners = new Set<() => void>();

function publish(present: boolean | undefined): void {
  snapshot = { present, version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

/** Current snapshot (stable reference between changes, for `useSyncExternalStore`). */
export function getSourcesPresenceSnapshot(): SourcesPresenceSnapshot {
  return snapshot;
}

/** Cached answer; `undefined` until {@link hasSources} has read IndexedDB (or after invalidation). */
export function getSourcesPresent(): boolean | undefined {
  return snapshot.present;
}

/** `useSyncExternalStore` subscription to changes of the cached answer. */
export function subscribeSourcesPresent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether at least one source exists. The first call reads IndexedDB; later calls are cached. */
export function hasSources(): Promise<boolean> {
  if (snapshot.present !== undefined) return Promise.resolve(snapshot.present);
  if (loading) return loading;
  const current = (async () => {
    const { sourcesRepo } = await import('@/core/db');
    return (await sourcesRepo.list()).length > 0;
  })();
  loading = current;
  current.then(
    (value) => {
      const latest = loading === current;
      if (latest) loading = undefined;
      // Applied unless something newer exists: a value set meanwhile, or a newer read in flight
      // (started after an invalidation) that will publish its own answer.
      if (latest || (snapshot.present === undefined && loading === undefined)) publish(value);
    },
    () => {
      // A failed read is not cached: the next check tries again.
      if (loading === current) loading = undefined;
    },
  );
  return current;
}

/** Records the answer after adding (true) or removing the last (false) source. */
export function setSourcesPresent(value: boolean): void {
  loading = undefined;
  publish(value);
}

/** Forgets the cached answer (after a bulk change such as "delete all data", and in tests). */
export function invalidateSourcesPresence(): void {
  loading = undefined;
  publish(undefined);
}
