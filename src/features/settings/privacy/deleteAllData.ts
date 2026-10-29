// "Delete all data" (SRC-10): removes everything the app stored on this device; the caller then
// restarts the app on onboarding (`appRestart` in core/session).
//
// What is deleted, in order:
// 1. The data worker is terminated first: it holds its own IndexedDB connection (which would block
//    the deletion), may be writing a sync, and keeps the search index cache in memory.
// 2. IndexedDB: this tab's database is LOCKED (closed, and never reopened until the page reloads,
//    so a mounted screen cannot recreate it or write data back), then the `simple-iptv` database is
//    deleted as a whole. It holds the lists, catalogue, favorites, history, settings AND the vault
//    — the encrypted secrets and the non-extractable device key — so no secret survives.
//    Other tabs: Dexie closes their connection on `versionchange` and core/db locks them; once
//    deleted, the other tabs are told on a BroadcastChannel and restart (core/session).
//    A tab that does not let go leaves the deletion blocked: after a timeout it is reported (the
//    request stays pending; `pendingDatabase` resolves if it completes later, and a retry waits for
//    that same request instead of starting another one). A deletion that fails outright unlocks the
//    database again: the data is still there and the app keeps working.
// 3. Cache Storage: the app never caches user data (no runtime caching, build/pwa.ts), only the app
//    shell precache. Decision (AC2): the precache of this app's service worker is KEPT — it holds
//    build files only, no user data, and deleting it would break starting offline until the next
//    app update (Workbox only fills it when a new service worker installs). Every other cache of
//    this app is deleted. Caches are recognised by this app's scope URL, which Workbox puts in
//    every cache name: on a shared origin (GitHub Pages user site) other apps' caches are not ours.
// 4. localStorage / sessionStorage: only this app's keys (`simple-iptv:` prefix — language, theme,
//    chunk-reload guard — and React Router's scroll positions); other apps on the same origin keep
//    theirs.
// 5. In memory, only once the database is gone: the log redactor's secrets and the diagnostic log
//    buffer (while the secrets may still be stored, redaction stays on). Everything else held in
//    memory (active list, playback flags, the sources presence cache, language, theme…) is reset by
//    the restart that must follow a deleted (or pending) database.
// The service worker registration is not touched: the app stays installed (AC2).
// A failed step does not stop the others; the result names the failed ones and the UI offers to
// retry, which runs every step again (they are idempotent).
import {
  DatabaseUnavailableError,
  lockDatabase,
  unlockDatabase,
  wipeAll,
  withTimeout,
} from '@/core/db';
import { clearLogBuffer, clearSecrets, log } from '@/core/log';
import { announceDataDeleted } from '@/core/session';

export type DeleteStep = 'database' | 'caches' | 'storage';
export const DELETE_STEPS: readonly DeleteStep[] = ['database', 'caches', 'storage'];

export interface DeleteAllDataResult {
  /** Steps that failed (empty: everything was deleted). */
  failed: DeleteStep[];
  /** The database is gone (and locked in this tab): the app must restart. */
  databaseDeleted: boolean;
  /**
   * The deletion was blocked (another tab) and is still pending: resolves `true` if it completes
   * later (the app must then restart), `false` if it fails (the database is unlocked again).
   */
  pendingDatabase?: Promise<boolean>;
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
  /** Locks this tab's database (no reopen until reload) / lifts the lock. */
  lockDatabase: () => Promise<void>;
  unlockDatabase: () => void;
  /** Deletes the IndexedDB database. */
  deleteDatabase: () => Promise<void>;
  /** Tells the app's other tabs (they restart). */
  announce: () => void;
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
    lockDatabase,
    unlockDatabase,
    deleteDatabase: wipeAll,
    announce: () => announceDataDeleted(),
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

/** The database deletion in progress (one at a time: a retry waits for it). */
let databaseDeletion: Promise<void> | undefined;

function deleteDatabaseOnce(deps: DeleteAllDataDeps): Promise<void> {
  if (!databaseDeletion) {
    const deletion: Promise<void> = deps.deleteDatabase().finally(() => {
      if (databaseDeletion === deletion) databaseDeletion = undefined;
    });
    databaseDeletion = deletion;
  }
  return databaseDeletion;
}

/** Once the database (secrets included) is gone: forget them in memory, tell the other tabs. */
function afterDatabaseDeleted(deps: DeleteAllDataDeps): void {
  clearSecrets();
  clearLogBuffer();
  deps.announce();
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

const isTimeout = (error: unknown) =>
  error instanceof DatabaseUnavailableError && error.reason === 'timeout';

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

  let databaseDeleted = false;
  let pendingDatabase: Promise<boolean> | undefined;
  try {
    await deps.lockDatabase();
    const deletion = deleteDatabaseOnce(deps);
    try {
      await withTimeout(deletion, deps.timeoutMs);
      databaseDeleted = true;
    } catch (error) {
      if (!isTimeout(error)) throw error;
      log.warn('Delete all data: database deletion blocked (another tab?)');
      pendingDatabase = deletion.then(
        () => {
          afterDatabaseDeleted(deps);
          return true;
        },
        (late: unknown) => {
          log.warn('Delete all data: blocked database deletion failed', { error: late });
          deps.unlockDatabase();
          return false;
        },
      );
    }
  } catch (error) {
    log.warn('Delete all data: database not deleted', { error });
    deps.unlockDatabase();
  }
  if (!databaseDeleted) failed.push('database');

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

  if (databaseDeleted) afterDatabaseDeleted(deps);
  else log.warn('Delete all data: partial failure', { failed });
  return pendingDatabase
    ? { failed, databaseDeleted, pendingDatabase }
    : { failed, databaseDeleted };
}
