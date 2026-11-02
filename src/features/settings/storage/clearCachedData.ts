// "Clear cached data" (STO-01 AC2–AC5): removes data the app can fetch or rebuild again, never the
// lists' configuration or the user's own data.
//
// Order:
// 1. The data worker is terminated first (as "Delete all data" does): a sync, guide import or index
//    build in progress stops, and its open IndexedDB transactions abort as a whole (every catalogue
//    write is one transaction per type, so nothing is left half-written). It also drops the search
//    index the worker keeps in memory. The next task starts a fresh worker.
// 2. The selected parts (`storageRepo` in core/db): guide, search indexes, other caches of this app
//    (Cache Storage, never the app-shell precache), and the catalogue of the selected lists, whose
//    sync state is reset to "never synced".
// 3. Lists whose catalogue was cleared are queued for a sync (`markSourcesForSync`, the same queue a
//    backup import uses); the caller then restarts the app on "My lists", so every in-memory store
//    re-reads storage and the start-up refresh syncs them (Xtream: never synced = due; M3U URL:
//    the queue; a local M3U file needs the file again).
//
// Never removed: lists (`sources`) and their vault secrets, settings (personal proxy and its token,
// master password, parental PIN, playback preferences, learned live formats), favorites, history
// and the app-shell precache.
import { storageRepo } from '@/core/db';
import { log } from '@/core/log';
import { markSourcesForSync } from '@/core/session';
import { isAppDataCache } from '../privacy/deleteAllData';

export interface ClearSelection {
  guide: boolean;
  search: boolean;
  otherCaches: boolean;
  /** Lists whose catalogue is removed. */
  catalogue: readonly string[];
}

export type ClearPart = 'guide' | 'search' | 'otherCaches' | 'catalogue';

export interface ClearResult {
  failed: ClearPart[];
  /** Lists whose catalogue was removed: the app must restart. */
  clearedLists: string[];
}

export interface ClearDeps {
  stopWorker: () => Promise<void>;
  caches: CacheStorage | undefined;
  scope: string;
  queueSync: (ids: readonly string[]) => void;
}

function defaultDeps(): ClearDeps {
  return {
    stopWorker: async () => {
      const { terminateDataWorker } = await import('@/worker');
      terminateDataWorker();
    },
    caches: typeof caches === 'undefined' ? undefined : caches,
    scope: new URL(import.meta.env.BASE_URL, globalThis.location.href).href,
    queueSync: markSourcesForSync,
  };
}

/** Whether anything is selected. */
export function hasSelection(selection: ClearSelection): boolean {
  return (
    selection.guide || selection.search || selection.otherCaches || selection.catalogue.length > 0
  );
}

async function deleteOtherCaches(cacheStorage: CacheStorage | undefined, scope: string) {
  if (!cacheStorage) return;
  const names = (await cacheStorage.keys()).filter((name) => isAppDataCache(name, scope));
  await Promise.all(names.map((name) => cacheStorage.delete(name)));
}

/** Clears the selected parts (see the header). Never rejects: failures are in `failed`. */
export async function clearCachedData(
  selection: ClearSelection,
  overrides: Partial<ClearDeps> = {},
): Promise<ClearResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const failed: ClearPart[] = [];
  const clearedLists: string[] = [];

  try {
    await deps.stopWorker();
  } catch (error) {
    // Its chunk could not load: then it was never started, and nothing of it is writing.
    log.warn('Clear cached data: could not stop the data worker', { error });
  }

  const step = async (part: ClearPart, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      log.warn('Clear cached data: a part was not cleared', { part, error });
      failed.push(part);
    }
  };

  if (selection.catalogue.length > 0) {
    // One list at a time: a failure keeps the lists already cleared in the result (and queued).
    await step('catalogue', async () => {
      for (const id of selection.catalogue) {
        clearedLists.push(...(await storageRepo.clearCatalogue([id])));
      }
    });
    if (clearedLists.length > 0) deps.queueSync(clearedLists);
  }
  if (selection.search) await step('search', () => storageRepo.clearSearchIndexes());
  if (selection.guide) await step('guide', () => storageRepo.clearGuide());
  if (selection.otherCaches) {
    await step('otherCaches', () => deleteOtherCaches(deps.caches, deps.scope));
  }
  return { failed, clearedLists };
}
