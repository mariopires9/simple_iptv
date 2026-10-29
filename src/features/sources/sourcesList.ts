// The saved lists (SRC-08) as a small reactive store shared by the top-bar selector and the
// "My lists" page. Whoever adds, renames, removes or syncs a list calls `reloadSources()` (or
// `reloadSourcesIfLoaded()`), so both stay current without polling.
//
// Statically reachable from the app shell via the selector slot: `@/core/db` is imported
// dynamically and its types as types only.
import { useEffect, useSyncExternalStore } from 'react';
import type { Source } from '@/core/db';
import { detectLocale, type Locale } from '@/i18n';

export interface SourcesListSnapshot {
  /** In creation order; `undefined` until first read. */
  readonly sources: readonly Source[] | undefined;
  /** Error of the last read, when it failed. */
  readonly error: unknown;
  /** When the list was last published (epoch ms): the "now" of relative times. */
  readonly readAt: number;
  readonly version: number;
}

let snapshot: SourcesListSnapshot = { sources: undefined, error: undefined, readAt: 0, version: 0 };
let latestRead = 0;
let inFlight: Promise<readonly Source[]> | undefined;
/** A read queued behind the one in flight (see `reloadSources('fresh')`). */
let queued: Promise<readonly Source[]> | undefined;
const listeners = new Set<() => void>();

function publish(sources: readonly Source[] | undefined, error: unknown): void {
  snapshot = { sources, error, readAt: Date.now(), version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

export function getSourcesListSnapshot(): SourcesListSnapshot {
  return snapshot;
}

export function subscribeSourcesList(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reads every list from storage and publishes it.
 * - `fresh` (default, after a change): the answer reflects storage as of this call — a read already
 *   in flight may predate the change, so one more read is queued behind it (and shared by every
 *   caller that asks meanwhile).
 * - `shared` (a screen opening, the menu opening): joins a read already in flight.
 * At most one read runs at a time; the latest one wins.
 */
export function reloadSources(mode: 'fresh' | 'shared' = 'fresh'): Promise<readonly Source[]> {
  if (inFlight) {
    if (mode === 'shared') return inFlight;
    queued ??= inFlight.then(startRead, startRead);
    return queued;
  }
  return startRead();
}

function startRead(): Promise<readonly Source[]> {
  queued = undefined;
  const read = ++latestRead;
  const current = (async () => {
    const { sourcesRepo } = await import('@/core/db');
    return sourcesRepo.list();
  })();
  inFlight = current;
  current.then(
    (sources) => {
      if (inFlight === current) inFlight = undefined;
      if (read === latestRead) publish(sources, undefined);
    },
    (error: unknown) => {
      if (inFlight === current) inFlight = undefined;
      if (read === latestRead) publish(snapshot.sources, error);
    },
  );
  return current;
}

/** Re-reads only if someone already uses the list (avoids touching storage needlessly). */
export function reloadSourcesIfLoaded(): void {
  if (snapshot.sources !== undefined || inFlight !== undefined) {
    reloadSources().catch(() => undefined);
  }
}

/** Forgets the cached list (tests, "delete all data"). */
export function forgetSources(): void {
  latestRead++;
  inFlight = undefined;
  queued = undefined;
  publish(undefined, undefined);
}

/** The saved lists; the first use triggers a read (unless `enabled` is false). */
export function useSourcesList(enabled = true): SourcesListSnapshot {
  const current = useSyncExternalStore(subscribeSourcesList, getSourcesListSnapshot);
  const needsRead = enabled && current.sources === undefined && current.error === undefined;
  useEffect(() => {
    if (needsRead) reloadSources('shared').catch(() => undefined);
  }, [needsRead]);
  return current;
}

/**
 * The list screens actually use: the stored one when it still exists, otherwise the first list
 * in creation order (the same fallback as the Live screen).
 */
export function effectiveActiveId(
  sources: readonly Pick<Source, 'id'>[],
  storedId: string | undefined,
): string | undefined {
  if (storedId !== undefined && sources.some((s) => s.id === storedId)) return storedId;
  return sources[0]?.id;
}

const collators = new Map<Locale, Intl.Collator>();
function collator(locale: Locale): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    collators.set(locale, c);
  }
  return c;
}

/** Display order: the active list first, then by name (locale-aware), then by creation. */
export function sortSources<S extends Pick<Source, 'id' | 'name' | 'createdAt'>>(
  sources: readonly S[],
  activeId: string | undefined,
  locale: Locale = detectLocale(),
): S[] {
  const compare = collator(locale).compare;
  return [...sources].sort(
    (a, b) =>
      Number(b.id === activeId) - Number(a.id === activeId) ||
      compare(a.name, b.name) ||
      a.createdAt - b.createdAt,
  );
}
