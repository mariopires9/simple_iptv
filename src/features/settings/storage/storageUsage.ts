// Settings › Storage breakdown (STO-01 AC1): per list (catalogue, search index, guide) plus the
// app files (the service worker's precache) and any other cache of this app. Everything is an
// estimate (see `storageRepo` in core/db): the UI says "about".
//
// Images: logos and posters are never stored by the app (ARCHITECTURE.md §7, build/pwa.ts: no
// runtime caching). They live in the browser's own HTTP cache, which pages cannot measure or
// clear, so they are not part of the breakdown; the screen says so.
//
// Never blocks the UI: each list is a few index counts and small sample reads, with a pause on an
// idle callback between reads; Cache Storage sizes come from `content-length` (a response's body
// is read only when the header is missing). An AbortSignal stops it between steps (unmount).
import { sourcesRepo, storageRepo, type SourceStorageEstimate } from '@/core/db';
import { isAppDataCache, PRECACHE_PREFIX } from '../privacy/deleteAllData';

export interface ListUsage extends SourceStorageEstimate {
  name: string;
  kind: 'xtream' | 'm3u-url' | 'm3u-file';
}

export interface StorageBreakdown {
  lists: ListUsage[];
  /** App shell precache (never cleared). */
  appFiles: number;
  /** Other caches of this app (none expected; cleared with "Other cached files"). */
  otherCaches: number;
}

export interface BreakdownDeps {
  caches: CacheStorage | undefined;
  /** Absolute URL of the app's scope (Workbox puts it in its cache names). */
  scope: string;
  pause: () => Promise<void>;
}

/** Waits for an idle moment (or a macrotask where `requestIdleCallback` is missing, e.g. Safari). */
export function idlePause(): Promise<void> {
  return new Promise((resolve) => {
    const g = globalThis as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    };
    if (typeof g.requestIdleCallback === 'function')
      g.requestIdleCallback(resolve, { timeout: 200 });
    else setTimeout(resolve, 0);
  });
}

export function defaultBreakdownDeps(): BreakdownDeps {
  return {
    caches: typeof caches === 'undefined' ? undefined : caches,
    scope: new URL(import.meta.env.BASE_URL, globalThis.location.href).href,
    pause: idlePause,
  };
}

const aborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
};

async function responseSize(response: Response): Promise<number> {
  const header = Number(response.headers.get('content-length'));
  if (Number.isFinite(header) && header > 0) return header;
  try {
    return (await response.blob()).size;
  } catch {
    return 0;
  }
}

/** Bytes held by the caches whose name `matches`, summed response by response. */
export async function cacheBytes(
  cacheStorage: CacheStorage | undefined,
  matches: (name: string) => boolean,
  { signal, pause }: { signal?: AbortSignal; pause: () => Promise<void> },
): Promise<number> {
  if (!cacheStorage) return 0;
  let total = 0;
  for (const name of (await cacheStorage.keys()).filter(matches)) {
    const cache = await cacheStorage.open(name);
    for (const request of await cache.keys()) {
      aborted(signal);
      const response = await cache.match(request);
      if (response) total += await responseSize(response);
    }
    await pause();
  }
  return total;
}

export const isPrecache = (name: string, scope: string) =>
  name.startsWith(PRECACHE_PREFIX) && name.includes(scope);

/** Computes the whole breakdown; rejects with the signal's reason once aborted. */
export async function loadStorageBreakdown(
  signal?: AbortSignal,
  overrides: Partial<BreakdownDeps> = {},
): Promise<StorageBreakdown> {
  const deps = { ...defaultBreakdownDeps(), ...overrides };
  const lists: ListUsage[] = [];
  for (const source of await sourcesRepo.list()) {
    aborted(signal);
    const estimate = await storageRepo.estimateSource(source.id, { signal, pause: deps.pause });
    lists.push({ ...estimate, name: source.name, kind: source.kind });
  }
  const options = { signal, pause: deps.pause };
  const appFiles = await cacheBytes(deps.caches, (n) => isPrecache(n, deps.scope), options);
  const otherCaches = await cacheBytes(deps.caches, (n) => isAppDataCache(n, deps.scope), options);
  aborted(signal);
  return { lists, appFiles, otherCaches };
}

/** Sizes of the "Clear cached data" options for a breakdown. */
export function clearableSizes(breakdown: StorageBreakdown) {
  let guide = 0;
  let search = 0;
  for (const list of breakdown.lists) {
    guide += list.guide.bytes;
    search += list.search.bytes;
  }
  return { guide, search, otherCaches: breakdown.otherCaches };
}

/** Bytes of one list's catalogue (its search index goes with it). */
export const catalogueBytes = (list: ListUsage) => list.catalogue.bytes + list.search.bytes;
