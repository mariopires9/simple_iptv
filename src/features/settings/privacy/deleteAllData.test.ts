// SRC-10: "Delete all data" — the real database deletion on fake-indexeddb (vault included), fake
// Cache Storage and Web Storage, step order and partial failures.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { DB_NAME, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { getLogEntries, log, redact, registerSecret } from '@/core/log';
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
    caches: fakeCaches([]).cacheStorage,
    scope: SCOPE,
    localStorage: fakeStorage({}),
    sessionStorage: fakeStorage({}),
    timeoutMs: 1000,
    ...overrides,
  };
}

afterEach(async () => {
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

    const result = await deleteAllData(
      deps({ caches: cacheStorage, localStorage: local, sessionStorage: session }),
    );

    expect(result).toEqual({ failed: [] });
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
  });

  it('stops the data worker before deleting the database', async () => {
    const order: string[] = [];
    await deleteAllData(
      deps({
        stopWorker: async () => void order.push('worker'),
        deleteDatabase: async () => void order.push('database'),
      }),
    );
    expect(order).toEqual(['worker', 'database']);
  });

  it('a database reopened afterwards is empty: no list, setting or secret survives', async () => {
    await seed();
    await deleteAllData(deps());
    expect(await sourcesRepo.list()).toEqual([]);
    expect(await settingsRepo.get('onboardingDone')).toBeUndefined();
    expect(await credentialVault.get('source:s1:url')).toBeUndefined();
  });

  it('forgets the redactor secrets and the diagnostic log buffer', async () => {
    registerSecret('very-secret-token');
    log.info('before delete');
    await deleteAllData(deps());
    expect(redact('x very-secret-token y')).toBe('x very-secret-token y');
    expect(getLogEntries()).toEqual([]);
  });

  it('AC3: a failing step is reported; the other steps still run', async () => {
    const { cacheStorage, store } = fakeCaches([RUNTIME]);
    const local = fakeStorage({ 'simple-iptv:theme': 'dark' });
    const result = await deleteAllData(
      deps({
        deleteDatabase: () => Promise.reject(new Error('boom')),
        caches: cacheStorage,
        localStorage: local,
      }),
    );
    expect(result).toEqual({ failed: ['database'] });
    expect(store.size).toBe(0);
    expect(local.getItem('simple-iptv:theme')).toBeNull();
  });

  it('a deletion blocked by another tab times out as a database failure', async () => {
    const result = await deleteAllData(
      deps({ deleteDatabase: () => new Promise<void>(() => undefined), timeoutMs: 20 }),
    );
    expect(result.failed).toEqual(['database']);
  });

  it('cache and storage failures are reported separately', async () => {
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
    expect(result.failed).toEqual(['caches', 'storage']);
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
