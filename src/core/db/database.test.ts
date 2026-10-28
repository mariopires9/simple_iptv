import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeDatabase,
  DatabaseClosedError,
  DatabaseUnavailableError,
  openDatabase,
  wipeAll,
} from './database';
import { SCHEMA_V1, type SimpleIptvDb } from './schema';
import { settingsRepo } from './repos/settings';
import { openFreshDatabase } from './test-utils';

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

/** Records the Dexie instances created (to check that no connection is left open). */
function trackInstances(): Dexie[] {
  const instances: Dexie[] = [];
  const original = Dexie.prototype.open;
  vi.spyOn(Dexie.prototype, 'open').mockImplementation(function (this: Dexie) {
    instances.push(this);
    return original.call(this);
  });
  return instances;
}

describe('close and wipe while opening', () => {
  it('closeDatabase() during open: the connection is closed and never becomes active', async () => {
    const instances = trackInstances();
    const factory = new IDBFactory();
    const pending = openDatabase({ indexedDB: factory, IDBKeyRange });
    await closeDatabase();
    await expect(pending).rejects.toBeInstanceOf(DatabaseClosedError);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.isOpen()).toBe(false);

    // The next open creates a new connection (does not reuse the cancelled one).
    const db = await openDatabase({ indexedDB: factory, IDBKeyRange });
    expect(db).not.toBe(instances[0]);
    expect(db.isOpen()).toBe(true);
  });

  it('wipeAll() during open: waits, closes and deletes; nothing stays cached', async () => {
    const instances = trackInstances();
    const factory = new IDBFactory();
    const pending = openDatabase({ indexedDB: factory, IDBKeyRange });
    await wipeAll();
    await expect(pending).rejects.toBeInstanceOf(DatabaseClosedError);
    expect(instances[0]?.isOpen()).toBe(false);
    expect((await factory.databases()).map((d) => d.name)).not.toContain('simple-iptv');

    const db: SimpleIptvDb = await openDatabase({ indexedDB: factory, IDBKeyRange });
    expect(db).not.toBe(instances[0]);
    await expect(settingsRepo.get('theme')).resolves.toBeUndefined();
  });
});

/** Opens the database directly on the factory (without Dexie) to inspect the real schema. */
function rawOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('error'));
  });
}

/** Factory whose `open()` fails as in restricted private modes. */
function failingFactory(error: () => unknown): IDBFactory {
  const real = new IDBFactory();
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'open') {
        return () => {
          throw error();
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('openDatabase — schema v1 (CA1)', () => {
  it('creates the simple-iptv v1 database with all tables and indexes from ARCHITECTURE.md §5', async () => {
    const { db, factory } = await openFreshDatabase();
    expect(db.name).toBe('simple-iptv');
    expect(db.verno).toBe(1);
    await closeDatabase();

    const raw = await rawOpen(factory, 'simple-iptv');
    const stores = [...raw.objectStoreNames].sort();
    expect(stores).toEqual(
      [
        'sources',
        'secrets',
        'keys',
        'categories',
        'channels',
        'movies',
        'series',
        'seriesDetails',
        'favorites',
        'history',
        'epgPrograms',
        'settings',
        'searchIndex',
      ].sort(),
    );

    const tx = raw.transaction(stores, 'readonly');
    const describeStore = (name: string) => {
      const store = tx.objectStore(name);
      return {
        keyPath: store.keyPath,
        indexes: Object.fromEntries([...store.indexNames].map((i) => [i, store.index(i).keyPath])),
      };
    };
    expect(describeStore('sources')).toEqual({
      keyPath: 'id',
      indexes: { createdAt: 'createdAt' },
    });
    expect(describeStore('secrets')).toEqual({ keyPath: 'ref', indexes: {} });
    expect(describeStore('keys')).toEqual({ keyPath: 'id', indexes: {} });
    expect(describeStore('categories')).toEqual({
      keyPath: 'key',
      indexes: { '[sourceId+type]': ['sourceId', 'type'], sourceId: 'sourceId' },
    });
    expect(describeStore('channels')).toEqual({
      keyPath: 'key',
      indexes: {
        '[categoryKey+order]': ['categoryKey', 'order'],
        sourceId: 'sourceId',
        nameNorm: 'nameNorm',
      },
    });
    expect(describeStore('movies')).toEqual({
      keyPath: 'key',
      indexes: {
        '[categoryKey+order]': ['categoryKey', 'order'],
        sourceId: 'sourceId',
        addedAt: 'addedAt',
      },
    });
    expect(describeStore('series')).toEqual({
      keyPath: 'key',
      indexes: { '[categoryKey+order]': ['categoryKey', 'order'], sourceId: 'sourceId' },
    });
    expect(describeStore('seriesDetails')).toEqual({
      keyPath: 'seriesKey',
      indexes: { fetchedAt: 'fetchedAt' },
    });
    expect(describeStore('favorites')).toEqual({
      keyPath: 'itemKey',
      indexes: { '[sourceId+type]': ['sourceId', 'type'], addedAt: 'addedAt' },
    });
    expect(describeStore('history')).toEqual({
      keyPath: 'itemKey',
      indexes: { '[sourceId+type]': ['sourceId', 'type'], lastWatchedAt: 'lastWatchedAt' },
    });
    expect(describeStore('epgPrograms')).toEqual({
      keyPath: ['channelEpgId', 'start'],
      indexes: { end: 'end', sourceId: 'sourceId' },
    });
    expect(describeStore('settings')).toEqual({ keyPath: 'key', indexes: {} });
    expect(describeStore('searchIndex')).toEqual({ keyPath: 'sourceId', indexes: {} });
    raw.close();
  });

  it('SCHEMA_V1 has exactly 13 tables', () => {
    expect(Object.keys(SCHEMA_V1)).toHaveLength(13);
  });

  it('is idempotent: repeated calls return the same instance', async () => {
    const { db } = await openFreshDatabase();
    await expect(openDatabase()).resolves.toBe(db);
  });
});

describe('openDatabase — IndexedDB unavailable (CA5)', () => {
  it('without the IndexedDB API rejects with DatabaseUnavailableError("unsupported")', async () => {
    expect(globalThis.indexedDB).toBeUndefined(); // jsdom does not implement IndexedDB
    const error = await openDatabase().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ reason: 'unsupported' });
    expect((error as Error).message).toBe('IndexedDB unavailable (unsupported)');
  });

  it.each(['SecurityError', 'InvalidStateError', 'UnknownError'])(
    'open() failing with %s rejects with DatabaseUnavailableError("open-failed")',
    async (name) => {
      const factory = failingFactory(() => new DOMException('blocked', name));
      const error = await openDatabase({ indexedDB: factory, IDBKeyRange }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect(error).toMatchObject({ reason: 'open-failed', name: 'DatabaseUnavailableError' });
      expect((error as DatabaseUnavailableError).cause).toBeDefined();
    },
  );

  it('open() with no response rejects with DatabaseUnavailableError("timeout")', async () => {
    const real = new IDBFactory();
    const hanging = new Proxy(real, {
      get(target, prop) {
        if (prop === 'open') return () => ({}) as IDBOpenDBRequest; // never fires events
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const error = await openDatabase({ indexedDB: hanging, IDBKeyRange, timeoutMs: 50 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ reason: 'timeout' });
  });

  it('can retry after a failure', async () => {
    const bad = failingFactory(() => new DOMException('x', 'SecurityError'));
    await expect(openDatabase({ indexedDB: bad, IDBKeyRange })).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    await expect(openFreshDatabase()).resolves.toBeDefined();
  });

  it('repositories propagate DatabaseUnavailableError', async () => {
    await expect(settingsRepo.get('theme')).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });
});

describe('wipeAll', () => {
  it('deletes the whole database', async () => {
    const { factory } = await openFreshDatabase();
    await settingsRepo.set('theme', 'dark');
    await wipeAll();
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).not.toContain('simple-iptv');

    // Reopening on the same factory creates an empty database.
    await openDatabase({ indexedDB: factory, IDBKeyRange });
    await expect(settingsRepo.get('theme')).resolves.toBeUndefined();
  });
});
