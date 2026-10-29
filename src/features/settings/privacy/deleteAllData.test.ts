// SRC-10: "Delete all data" — the real database deletion on fake-indexeddb (vault included), fake
// Cache Storage and Web Storage, step order, the lock, a blocked deletion and partial failures.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  DatabaseLockedError,
  DB_NAME,
  isDatabaseLocked,
  settingsRepo,
  sourcesRepo,
  unlockDatabase,
  wipeAll,
} from '@/core/db';
import { clearSecrets, getLogEntries, log, redact, registerSecret } from '@/core/log';
import {
  deleteAllData,
  isAppDataCache,
  isAppStorageKey,
  PRECACHE_PREFIX,
  SCROLL_POSITIONS_KEY,
  type DeleteAllDataDeps,
} from './deleteAllData';

const SCOPE = 'https://user.example.test/simple_iptv/';
const PRECACHE = `${PRECACHE_PREFIX}-v2-${SCOPE}`;
const RUNTIME = `workbox-runtime-${SCOPE}`;
const FOREIGN = 'workbox-precache-v2-https://user.example.test/other_app/';

/** In-memory CacheStorage with just what the deletion uses. */
function fakeCaches(names: string[], { failOn }: { failOn?: string } = {}) {
  const store = new Set(names);
  const cacheStorage = {
    keys: vi.fn(() => Promise.resolve([...store])),
    delete: vi.fn((name: string) => {
      if (name === failOn) return Promise.reject(new Error('locked'));
      return Promise.resolve(store.delete(name));
    }),
  } as unknown as CacheStorage;
  return { cacheStorage, store };
}

/** In-memory Web Storage. */
function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).map((d) => d.name ?? '');
}

async function seed() {
  await sourcesRepo.put({
    id: 's1',
    kind: 'm3u-url',
    name: 'List',
    secretRef: 'source:s1:url',
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 1, movies: 0, series: 0 },
  });
  await credentialVault.put('source:s1:url', 'https://lists.example.test/get?token=abc123secret');
  await settingsRepo.set('activeSourceId', 's1');
  await settingsRepo.set('onboardingDone', true);
}

function deps(overrides: Partial<DeleteAllDataDeps> = {}): Partial<DeleteAllDataDeps> {
  return {
    stopWorker: vi.fn(() => Promise.resolve()),
    announce: vi.fn(),
    caches: fakeCaches([]).cacheStorage,
    scope: SCOPE,
    localStorage: fakeStorage({}),
    sessionStorage: fakeStorage({}),
    timeoutMs: 1000,
    ...overrides,
  };
}

afterEach(async () => {
  unlockDatabase();
  await wipeAll();
});

describe('deleteAllData (SRC-10)', () => {
  it('AC1: deletes the database (vault included), app caches and app web storage keys', async () => {
    await seed();
    expect(await databaseNames()).toContain(DB_NAME);
    const { cacheStorage, store } = fakeCaches([PRECACHE, RUNTIME, `my-data-${SCOPE}`, FOREIGN]);
    const local = fakeStorage({
      'simple-iptv:language': 'pt-PT',
      'simple-iptv:theme': 'light',
      'other-app:setting': 'x',
    });
    const session = fakeStorage({
      'simple-iptv:chunk-reload-at': '1',
      [SCROLL_POSITIONS_KEY]: '{}',
      'other-app:state': 'y',
    });
    const announce = vi.fn();

    const result = await deleteAllData(
      deps({ caches: cacheStorage, localStorage: local, sessionStorage: session, announce }),
    );

    expect(result).toEqual({ failed: [], databaseDeleted: true });
    expect(await databaseNames()).not.toContain(DB_NAME);
    // AC2: the app shell precache stays (the app keeps starting, also offline); other apps'
    // caches on the same origin are not touched; this app's data caches are gone.
    expect([...store].sort()).toEqual([FOREIGN, PRECACHE].sort());
    expect(local.getItem('simple-iptv:language')).toBeNull();
    expect(local.getItem('simple-iptv:theme')).toBeNull();
    expect(local.getItem('other-app:setting')).toBe('x');
    expect(session.getItem('simple-iptv:chunk-reload-at')).toBeNull();
    expect(session.getItem(SCROLL_POSITIONS_KEY)).toBeNull();
    expect(session.getItem('other-app:state')).toBe('y');
    // The other tabs are told (they lock and restart).
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('stops the data worker, then locks, then deletes the database', async () => {
    const order: string[] = [];
    await deleteAllData(
      deps({
        stopWorker: async () => void order.push('worker'),
        lockDatabase: async () => void order.push('lock'),
        deleteDatabase: async () => void order.push('database'),
      }),
    );
    expect(order).toEqual(['worker', 'lock', 'database']);
  });

  it('this tab cannot recreate the database afterwards (locked until reload)', async () => {
    await seed();
    await deleteAllData(deps());
    expect(isDatabaseLocked()).toBe(true);
    // A mounted screen writing now fails instead of recreating the database.
    await expect(settingsRepo.set('theme', 'dark')).rejects.toBeInstanceOf(DatabaseLockedError);
    expect(await databaseNames()).not.toContain(DB_NAME);
    // After the restart (lock lifted) it is empty: no list, setting or secret survives.
    unlockDatabase();
    expect(await sourcesRepo.list()).toEqual([]);
    expect(await settingsRepo.get('onboardingDone')).toBeUndefined();
    expect(await credentialVault.get('source:s1:url')).toBeUndefined();
  });

  it('forgets the redactor secrets and the log buffer once the database is gone', async () => {
    registerSecret('very-secret-token');
    log.info('before delete');
    await deleteAllData(deps());
    expect(redact('x very-secret-token y')).toBe('x very-secret-token y');
    expect(getLogEntries()).toEqual([]);
  });

  it('AC3: a failed database deletion keeps redaction, unlocks the database; other steps run', async () => {
    registerSecret('still-stored-secret');
    const { cacheStorage, store } = fakeCaches([RUNTIME]);
    const local = fakeStorage({ 'simple-iptv:theme': 'dark' });
    const announce = vi.fn();
    const result = await deleteAllData(
      deps({
        deleteDatabase: () => Promise.reject(new Error('boom')),
        caches: cacheStorage,
        localStorage: local,
        announce,
      }),
    );
    expect(result).toEqual({ failed: ['database'], databaseDeleted: false });
    expect(store.size).toBe(0);
    expect(local.getItem('simple-iptv:theme')).toBeNull();
    // The data is still there: the app keeps working and keeps redacting.
    expect(isDatabaseLocked()).toBe(false);
    expect(redact('x still-stored-secret y')).not.toContain('still-stored-secret');
    expect(announce).not.toHaveBeenCalled();
    clearSecrets();
  });

  it('a blocked deletion is reported, stays pending, a retry reuses it; late success → restart', async () => {
    registerSecret('pending-secret');
    let finish: () => void = () => undefined;
    const deleteDatabase = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const announce = vi.fn();
    const first = await deleteAllData(deps({ deleteDatabase, announce, timeoutMs: 20 }));
    expect(first.failed).toEqual(['database']);
    expect(first.databaseDeleted).toBe(false);
    expect(first.pendingDatabase).toBeDefined();
    // Still locked while the deletion is pending (the app must restart, not reopen it).
    expect(isDatabaseLocked()).toBe(true);
    expect(redact('pending-secret')).not.toContain('pending-secret');

    // Retry: no second deletion, it waits for the same request.
    const second = await deleteAllData(deps({ deleteDatabase, announce, timeoutMs: 20 }));
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(second.failed).toEqual(['database']);

    finish();
    await expect(first.pendingDatabase).resolves.toBe(true);
    await expect(second.pendingDatabase).resolves.toBe(true);
    expect(redact('pending-secret')).toBe('pending-secret');
    expect(announce).toHaveBeenCalled();
  });

  it('a blocked deletion that fails later unlocks the database', async () => {
    let fail: (error: Error) => void = () => undefined;
    const deleteDatabase = () => new Promise<void>((_, reject) => (fail = reject));
    const result = await deleteAllData(deps({ deleteDatabase, timeoutMs: 20 }));
    expect(isDatabaseLocked()).toBe(true);
    fail(new Error('aborted'));
    await expect(result.pendingDatabase).resolves.toBe(false);
    expect(isDatabaseLocked()).toBe(false);
  });

  it('cache and storage failures are reported separately (the database is still gone)', async () => {
    const failing = fakeStorage({ 'simple-iptv:theme': 'dark' });
    failing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const result = await deleteAllData(
      deps({
        deleteDatabase: () => Promise.resolve(),
        caches: fakeCaches([RUNTIME], { failOn: RUNTIME }).cacheStorage,
        localStorage: failing,
      }),
    );
    expect(result).toEqual({ failed: ['caches', 'storage'], databaseDeleted: true });
  });

  it('works without Cache Storage or Web Storage (and when the worker cannot be stopped)', async () => {
    const result = await deleteAllData(
      deps({
        stopWorker: () => Promise.reject(new Error('chunk failed')),
        deleteDatabase: () => Promise.resolve(),
        caches: undefined,
        localStorage: undefined,
        sessionStorage: undefined,
      }),
    );
    expect(result.failed).toEqual([]);
  });
});

describe('what belongs to the app', () => {
  it('isAppDataCache: this scope, not the precache', () => {
    expect(isAppDataCache(RUNTIME, SCOPE)).toBe(true);
    expect(isAppDataCache(PRECACHE, SCOPE)).toBe(false);
    expect(isAppDataCache(`${PRECACHE}-temp`, SCOPE)).toBe(false);
    expect(isAppDataCache(FOREIGN, SCOPE)).toBe(false);
    expect(isAppDataCache('workbox-runtime-https://user.example.test/other_app/', SCOPE)).toBe(
      false,
    );
  });

  it('isAppStorageKey: the app prefix and the scroll positions', () => {
    expect(isAppStorageKey('simple-iptv:language')).toBe(true);
    expect(isAppStorageKey(SCROLL_POSITIONS_KEY)).toBe(true);
    expect(isAppStorageKey('simple-iptv-other')).toBe(false);
    expect(isAppStorageKey('language')).toBe(false);
  });
});
