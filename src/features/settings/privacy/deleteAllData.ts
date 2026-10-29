// "Delete all data" (SRC-10): removes everything the app stored on this device, then restarts the
// app on onboarding.
//
// What is deleted, in order:
// 1. The data worker is terminated first: it holds its own IndexedDB connection (which would block
//    the deletion), may be writing a sync, and keeps the search index cache in memory.
// 2. IndexedDB: the `simple-iptv` database is deleted as a whole (`wipeAll`: this tab's connection
//    is closed first). It holds the lists, catalogue, favorites, history, settings AND the vault —
//    the encrypted secrets and the non-extractable device key — so no secret survives. Other tabs
//    close their connection when asked (Dexie's `versionchange` handling); a tab that does not
//    leaves the deletion blocked, which is reported as a failure after a timeout (retry).
// 3. Cache Storage: the app never caches user data (no runtime caching, build/pwa.ts), only the app
//    shell precache. Decision (AC2): the precache of this app's service worker is KEPT — it holds
//    build files only, no user data, and deleting it would break starting offline until the next
//    app update (Workbox only fills it when a new service worker installs). Every other cache of
//    this app is deleted. Caches are recognised by this app's scope URL, which Workbox puts in
//    every cache name: on a shared origin (GitHub Pages user site) other apps' caches are not ours.
// 4. localStorage / sessionStorage: only this app's keys (`simple-iptv:` prefix — language, theme,
//    chunk-reload guard — and React Router's scroll positions); other apps on the same origin keep
//    theirs.
// 5. In memory: the log redactor's secrets and the diagnostic log buffer. Everything else held in
//    memory (active list, playback flags, the sources presence cache, language, theme…) is reset by
//    the restart that follows a full success (`restartOnOnboarding`): resetting those stores before
//    would make mounted screens read the (deleted) database again.
// The service worker registration is not touched: the app stays installed (AC2).
// A failed step does not stop the others; the result names the failed ones and the UI offers to
// retry, which runs every step again (they are idempotent).
import { clearLogBuffer, clearSecrets, log } from '@/core/log';

export type DeleteStep = 'database' | 'caches' | 'storage';
export const DELETE_STEPS: readonly DeleteStep[] = ['database', 'caches', 'storage'];

export interface DeleteAllDataResult {
  /** Steps that failed (empty: everything was deleted). */
  failed: DeleteStep[];
}

/** Keys of this app in Web Storage. */
export const APP_STORAGE_PREFIX = 'simple-iptv:';
/** React Router's `<ScrollRestoration>` (sessionStorage). */
export const SCROLL_POSITIONS_KEY = 'react-router-scroll-positions';
/** Workbox's precache cache names start with this (`workbox-precache-v2-<scope>`). */
export const PRECACHE_PREFIX = 'workbox-precache';
/** How long the database deletion may stay blocked by another tab before it is reported. */
export const DATABASE_DELETE_TIMEOUT_MS = 10_000;

export interface DeleteAllDataDeps {
  /** Terminates the data worker (closing its database connection and in-memory caches). */
  stopWorker: () => Promise<void>;
  /** Deletes the IndexedDB database. */
  deleteDatabase: () => Promise<void>;
  caches: CacheStorage | undefined;
  /** Absolute URL of the app's scope (`<origin><base>`), as in Workbox cache names. */
  scope: string;
  localStorage: Storage | undefined;
  sessionStorage: Storage | undefined;
  timeoutMs: number;
}

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return globalThis[kind] ?? undefined;
  } catch {
    // Access can throw (blocked site data).
    return undefined;
  }
}

function defaultDeps(): DeleteAllDataDeps {
  return {
    stopWorker: async () => {
      const { terminateDataWorker } = await import('@/worker');
      terminateDataWorker();
    },
    deleteDatabase: async () => {
      const { wipeAll } = await import('@/core/db');
      await wipeAll();
    },
    caches: typeof caches === 'undefined' ? undefined : caches,
    scope: new URL(import.meta.env.BASE_URL, globalThis.location.href).href,
    localStorage: storage('localStorage'),
    sessionStorage: storage('sessionStorage'),
    timeoutMs: DATABASE_DELETE_TIMEOUT_MS,
  };
}

/** A cache of this app that is not its app-shell precache (see the header). */
export function isAppDataCache(name: string, scope: string): boolean {
  return name.includes(scope) && !name.startsWith(PRECACHE_PREFIX);
}

/** Whether a Web Storage key belongs to this app. */
export function isAppStorageKey(key: string): boolean {
  return key.startsWith(APP_STORAGE_PREFIX) || key === SCROLL_POSITIONS_KEY;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Database deletion blocked')), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function deleteCaches(cacheStorage: CacheStorage | undefined, scope: string): Promise<void> {
  if (!cacheStorage) return;
  const names = (await cacheStorage.keys()).filter((name) => isAppDataCache(name, scope));
  const results = await Promise.allSettled(names.map((name) => cacheStorage.delete(name)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) throw new Error(`${failed.length} cache(s) could not be deleted`);
}

function clearStorage(target: Storage | undefined): void {
  if (!target) return;
  const keys: string[] = [];
  for (let i = 0; i < target.length; i++) {
    const key = target.key(i);
    if (key !== null && isAppStorageKey(key)) keys.push(key);
  }
  for (const key of keys) target.removeItem(key);
}

/** Deletes all local data (see the header). Never rejects: failures are in `failed`. */
export async function deleteAllData(
  overrides: Partial<DeleteAllDataDeps> = {},
): Promise<DeleteAllDataResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const failed: DeleteStep[] = [];

  try {
    await deps.stopWorker();
  } catch (error) {
    // Its chunk could not load: then it was never started either. The deletion reports a block.
    log.warn('Delete all data: could not stop the data worker', { error });
  }

  try {
    await withTimeout(deps.deleteDatabase(), deps.timeoutMs);
  } catch (error) {
    log.warn('Delete all data: database not deleted', { error });
    failed.push('database');
  }

  try {
    await deleteCaches(deps.caches, deps.scope);
  } catch (error) {
    log.warn('Delete all data: caches not deleted', { error });
    failed.push('caches');
  }

  try {
    clearStorage(deps.localStorage);
    clearStorage(deps.sessionStorage);
  } catch (error) {
    log.warn('Delete all data: web storage not cleared', { error });
    failed.push('storage');
  }

  clearSecrets();
  if (failed.length === 0) {
    clearLogBuffer();
  } else {
    log.warn('Delete all data: partial failure', { failed });
  }
  return { failed };
}

/** Indirection so tests can observe the restart (jsdom cannot reload). */
export const appRestart = {
  /**
   * Starts the app again on onboarding (HashRouter, ADR-007): the route is set without a
   * `hashchange` (the current screens must not react to it), then the page reloads, which resets
   * every in-memory store. The service worker serves the app shell.
   */
  restartOnOnboarding(): void {
    window.history.replaceState(null, '', '#/onboarding');
    window.location.reload();
  },
};
