// "Does the user have at least one source?" — read once per session and cached for the onboarding
// guard (UX-01 AC1). Whoever adds or removes a source updates the cache (`setSourcesPresent`), so
// the guard answers synchronously on every navigation after the first read.
//
// Statically reachable from the router (initial bundle): `@/core/db` is imported dynamically only.

let present: boolean | undefined;
let loading: Promise<boolean> | undefined;
const listeners = new Set<() => void>();

function publish(value: boolean | undefined): void {
  present = value;
  for (const listener of listeners) listener();
}

/** Cached answer; `undefined` until {@link hasSources} has read IndexedDB (or after invalidation). */
export function getSourcesPresent(): boolean | undefined {
  return present;
}

/** `useSyncExternalStore` subscription to changes of the cached answer. */
export function subscribeSourcesPresent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether at least one source exists. The first call reads IndexedDB; later calls are cached. */
export function hasSources(): Promise<boolean> {
  if (present !== undefined) return Promise.resolve(present);
  if (loading) return loading;
  const current = (async () => {
    const { sourcesRepo } = await import('@/core/db');
    return (await sourcesRepo.list()).length > 0;
  })();
  loading = current;
  current.then(
    (value) => {
      // A newer answer (set or invalidated meanwhile) wins over this read.
      if (loading === current) {
        loading = undefined;
        publish(value);
      }
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
