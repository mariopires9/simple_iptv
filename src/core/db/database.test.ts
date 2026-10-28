import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, DatabaseUnavailableError, openDatabase, wipeAll } from './database';
import { SCHEMA_V1 } from './schema';
import { settingsRepo } from './repos/settings';
import { openFreshDatabase } from './test-utils';

afterEach(() => {
  closeDatabase();
});

/** Abre a base diretamente na fábrica (sem Dexie) para inspecionar o schema real. */
function rawOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('erro'));
  });
}

/** Fábrica cujo `open()` falha como em modos privados restritos. */
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
  it('cria a base simple-iptv v1 com todas as tabelas e índices de ARCHITECTURE.md §5', async () => {
    const { db, factory } = await openFreshDatabase();
    expect(db.name).toBe('simple-iptv');
    expect(db.verno).toBe(1);
    closeDatabase();

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
        '[sourceId+categoryKey]': ['sourceId', 'categoryKey'],
        sourceId: 'sourceId',
        nameNorm: 'nameNorm',
      },
    });
    expect(describeStore('movies')).toEqual({
      keyPath: 'key',
      indexes: {
        '[sourceId+categoryKey]': ['sourceId', 'categoryKey'],
        sourceId: 'sourceId',
        addedAt: 'addedAt',
      },
    });
    expect(describeStore('series')).toEqual({
      keyPath: 'key',
      indexes: { '[sourceId+categoryKey]': ['sourceId', 'categoryKey'], sourceId: 'sourceId' },
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

  it('SCHEMA_V1 tem exatamente as 13 tabelas', () => {
    expect(Object.keys(SCHEMA_V1)).toHaveLength(13);
  });

  it('é idempotente: chamadas repetidas devolvem a mesma instância', async () => {
    const { db } = await openFreshDatabase();
    await expect(openDatabase()).resolves.toBe(db);
  });
});

describe('openDatabase — IndexedDB indisponível (CA5)', () => {
  it('sem API IndexedDB rejeita com DatabaseUnavailableError("unsupported")', async () => {
    expect(globalThis.indexedDB).toBeUndefined(); // jsdom não implementa IndexedDB
    const error = await openDatabase().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ reason: 'unsupported' });
    expect((error as DatabaseUnavailableError).userMessage).toMatch(/navegação privada/);
  });

  it.each(['SecurityError', 'InvalidStateError', 'UnknownError'])(
    'open() a falhar com %s rejeita com DatabaseUnavailableError("open-failed")',
    async (name) => {
      const factory = failingFactory(() => new DOMException('bloqueado', name));
      const error = await openDatabase({ indexedDB: factory, IDBKeyRange }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      expect(error).toMatchObject({ reason: 'open-failed', name: 'DatabaseUnavailableError' });
      expect((error as DatabaseUnavailableError).userMessage).toMatch(/armazenamento/);
      expect((error as DatabaseUnavailableError).cause).toBeDefined();
    },
  );

  it('open() sem resposta rejeita com DatabaseUnavailableError("timeout")', async () => {
    const real = new IDBFactory();
    const hanging = new Proxy(real, {
      get(target, prop) {
        if (prop === 'open') return () => ({}) as IDBOpenDBRequest; // nunca dispara eventos
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

  it('depois de uma falha é possível tentar de novo', async () => {
    const bad = failingFactory(() => new DOMException('x', 'SecurityError'));
    await expect(openDatabase({ indexedDB: bad, IDBKeyRange })).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    await expect(openFreshDatabase()).resolves.toBeDefined();
  });

  it('os repositórios propagam DatabaseUnavailableError', async () => {
    await expect(settingsRepo.get('theme')).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });
});

describe('wipeAll', () => {
  it('apaga a base inteira', async () => {
    const { factory } = await openFreshDatabase();
    await settingsRepo.set('theme', 'dark');
    await wipeAll();
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).not.toContain('simple-iptv');

    // Reabrir na mesma fábrica cria uma base vazia.
    await openDatabase({ indexedDB: factory, IDBKeyRange });
    await expect(settingsRepo.get('theme')).resolves.toBeUndefined();
  });
});
