// STO-01: "Clear cached data" — the worker is stopped first (AC5), each option clears only its part
// (AC2/AC3), cleared lists are queued for a sync (AC4), the precache is kept, failures reported.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, sourcesRepo, storageRepo, wipeAll, type Source } from '@/core/db';
import { PRECACHE_PREFIX } from '../privacy/deleteAllData';
import { clearCachedData, hasSelection } from './clearCachedData';
import { cacheBytes, isPrecache, loadStorageBreakdown } from './storageUsage';

const SCOPE = 'https://user.example.test/simple_iptv/';
const PRECACHE = `${PRECACHE_PREFIX}-v2-${SCOPE}`;
const OTHER = `images-${SCOPE}`;
const FOREIGN = `images-https://user.example.test/other_app/`;

function fakeCaches(contents: Record<string, Record<string, Response>>) {
  const store = new Map(Object.entries(contents));
  const cacheStorage = {
    keys: vi.fn(() => Promise.resolve([...store.keys()])),
    delete: vi.fn((name: string) => Promise.resolve(store.delete(name))),
    open: vi.fn((name: string) => {
      const entries = store.get(name) ?? {};
      return Promise.resolve({
        keys: () => Promise.resolve(Object.keys(entries).map((url) => new Request(url))),
        match: (request: Request) => Promise.resolve(entries[request.url]?.clone()),
      });
    }),
  } as unknown as CacheStorage;
  return { cacheStorage, store };
}

const list = (id: string): Source => ({
  id,
  kind: 'xtream',
  name: `List ${id}`,
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncAt: 5,
  lastSyncStatus: 'ok',
  stats: { live: 1, movies: 0, series: 0 },
});

beforeEach(async () => {
  await sourcesRepo.put(list('a'));
  await catalogRepo.replaceForSource('a', 'live', {
    categories: [{ externalId: '1', name: 'News' }],
    items: [{ externalId: '1', categoryExternalId: '1', name: 'One', streamPath: '1' }],
  });
});
afterEach(async () => {
  await wipeAll();
  vi.restoreAllMocks();
});

const none = { guide: false, search: false, otherCaches: false, catalogue: [] };

describe('clearCachedData (STO-01)', () => {
  it('stops the data worker before touching any data (AC5)', async () => {
    const order: string[] = [];
    vi.spyOn(storageRepo, 'clearGuide').mockImplementation(async () => {
      order.push('guide');
    });
    vi.spyOn(storageRepo, 'clearCatalogue').mockImplementation(async (ids) => {
      order.push('catalogue');
      return [...ids];
    });
    await clearCachedData(
      { ...none, guide: true, catalogue: ['a'] },
      {
        stopWorker: async () => {
          order.push('stop');
        },
        caches: undefined,
        scope: SCOPE,
        queueSync: () => order.push('queue'),
      },
    );
    expect(order[0]).toBe('stop');
    expect(order).toEqual(['stop', 'catalogue', 'queue', 'guide']);
  });

  it('catalogue: queues the cleared lists for a sync and reports them (AC4)', async () => {
    const queueSync = vi.fn();
    const result = await clearCachedData(
      { ...none, catalogue: ['a'] },
      { stopWorker: () => Promise.resolve(), caches: undefined, scope: SCOPE, queueSync },
    );
    expect(result).toEqual({ failed: [], clearedLists: ['a'] });
    expect(queueSync).toHaveBeenCalledWith(['a']);
    expect(await catalogRepo.count('a', 'live')).toBe(0);
    expect(await sourcesRepo.get('a')).toMatchObject({ lastSyncStatus: 'never' });
  });

  it('without the catalogue: no list is queued or reset', async () => {
    const queueSync = vi.fn();
    const result = await clearCachedData(
      { ...none, guide: true, search: true },
      { stopWorker: () => Promise.resolve(), caches: undefined, scope: SCOPE, queueSync },
    );
    expect(result).toEqual({ failed: [], clearedLists: [] });
    expect(queueSync).not.toHaveBeenCalled();
    expect(await catalogRepo.count('a', 'live')).toBe(1);
    expect(await sourcesRepo.get('a')).toMatchObject({ lastSyncStatus: 'ok', lastSyncAt: 5 });
  });

  it('other cached files: deletes this app’s other caches, never the precache (AC3)', async () => {
    const { cacheStorage, store } = fakeCaches({ [PRECACHE]: {}, [OTHER]: {}, [FOREIGN]: {} });
    await clearCachedData(
      { ...none, otherCaches: true },
      {
        stopWorker: () => Promise.resolve(),
        caches: cacheStorage,
        scope: SCOPE,
        queueSync: vi.fn(),
      },
    );
    expect([...store.keys()]).toEqual([PRECACHE, FOREIGN]);
  });

  it('a failed part is reported; the others still run; a worker that cannot stop is tolerated', async () => {
    vi.spyOn(storageRepo, 'clearSearchIndexes').mockRejectedValue(new Error('quota'));
    const guide = vi.spyOn(storageRepo, 'clearGuide');
    const result = await clearCachedData(
      { ...none, guide: true, search: true },
      {
        stopWorker: () => Promise.reject(new Error('chunk')),
        caches: undefined,
        scope: SCOPE,
        queueSync: vi.fn(),
      },
    );
    expect(result.failed).toEqual(['search']);
    expect(guide).toHaveBeenCalled();
  });

  it('hasSelection', () => {
    expect(hasSelection(none)).toBe(false);
    expect(hasSelection({ ...none, catalogue: ['a'] })).toBe(true);
  });
});

describe('storage breakdown (STO-01 AC1)', () => {
  it('sizes the precache from content-length or the body, and other caches separately', async () => {
    const { cacheStorage } = fakeCaches({
      [PRECACHE]: {
        [`${SCOPE}index.html`]: new Response('x', { headers: { 'content-length': '1500' } }),
        [`${SCOPE}app.js`]: new Response('y'.repeat(250)),
      },
      [OTHER]: { [`${SCOPE}a.png`]: new Response('z'.repeat(40)) },
      [FOREIGN]: { [`${SCOPE}b.png`]: new Response('z'.repeat(999)) },
    });
    const breakdown = await loadStorageBreakdown(undefined, {
      caches: cacheStorage,
      scope: SCOPE,
      pause: () => Promise.resolve(),
    });
    expect(breakdown.appFiles).toBe(1750);
    expect(breakdown.otherCaches).toBe(40);
    expect(breakdown.lists).toHaveLength(1);
    expect(breakdown.lists[0]).toMatchObject({ name: 'List a', catalogue: { live: 1 } });
  });

  it('stops when aborted (unmount)', async () => {
    const controller = new AbortController();
    controller.abort(new Error('unmounted'));
    await expect(
      loadStorageBreakdown(controller.signal, { caches: undefined, scope: SCOPE }),
    ).rejects.toThrow('unmounted');
    const { cacheStorage } = fakeCaches({ [PRECACHE]: { [`${SCOPE}a`]: new Response('a') } });
    await expect(
      cacheBytes(cacheStorage, (n) => isPrecache(n, SCOPE), {
        signal: controller.signal,
        pause: () => Promise.resolve(),
      }),
    ).rejects.toThrow('unmounted');
  });
});
