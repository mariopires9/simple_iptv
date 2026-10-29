// @vitest-environment node
// SCH-01: index storage in IndexedDB (fake-indexeddb), load without rebuild, staleness, queries
// with hydrated hits, and the 100k load-from-storage measurement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  catalogRepo,
  closeDatabase,
  itemKey,
  onCatalogWrite,
  openDatabase,
  sourcesRepo,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { SEARCH_INDEX_VERSION } from './searchIndex';
import {
  rebuildSearchIndex,
  rebuildSearchIndexAfterSync,
  resetSearchCacheForTests,
  searchCatalog,
  waitForSearchIndexIdle,
  warmUpSearch,
} from './searchService';

const SRC = 'src1';
const OTHER = 'src2';

function source(id: string, extra: Partial<Source> = {}): Source {
  return {
    id,
    kind: 'm3u-url',
    name: id,
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  };
}

async function seed(id = SRC): Promise<void> {
  await sourcesRepo.put(source(id));
  await catalogRepo.replaceAllForExistingSource(id, {
    live: {
      categories: [{ externalId: 'news', name: 'News' }],
      items: [
        {
          externalId: '1',
          categoryExternalId: 'news',
          name: 'Example News HD',
          number: 101,
          streamPath: '',
          streamUrl: 'https://cdn.example.test/u/p/1.ts',
        },
        {
          externalId: '2',
          categoryExternalId: 'news',
          name: 'Notícias Exemplo',
          number: 102,
          streamPath: '',
        },
      ],
    },
    movie: {
      categories: [{ externalId: 'm1', name: 'Action' }],
      items: [
        {
          externalId: '10',
          categoryExternalId: 'm1',
          name: 'Example Movie',
          year: 2024,
          streamPath: '',
        },
      ],
    },
    series: {
      categories: [],
      items: [{ externalId: '20', name: 'Example Drama', year: 2021 }],
    },
  });
}

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  resetSearchCacheForTests();
  clearLogBuffer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

describe('build and storage', () => {
  it('stores the serialized index of the source with its version', async () => {
    await seed();
    await rebuildSearchIndex(SRC, () => 1234);
    const entry = await catalogRepo.getSearchIndex(SRC);
    expect(entry).toMatchObject({
      sourceId: SRC,
      builtAt: 1234,
      version: SEARCH_INDEX_VERSION,
    });
    expect(entry?.data).not.toContain('cdn.example.test');
  });

  it('does not store an index for a removed source', async () => {
    await seed();
    await sourcesRepo.remove(SRC);
    expect(await rebuildSearchIndex(SRC)).toBeUndefined();
    expect(await catalogRepo.getSearchIndex(SRC)).toBeUndefined();
  });

  it('the after-sync hook only queues the build; a failure is logged', async () => {
    await seed();
    vi.spyOn(catalogRepo, 'putSearchIndexForExistingSource').mockRejectedValue(new Error('quota'));
    expect(rebuildSearchIndexAfterSync(SRC)).toBeUndefined();
    await waitForSearchIndexIdle(SRC);
    await vi.waitFor(() =>
      expect(getLogEntries().some((e) => e.message.includes('index build after sync failed'))).toBe(
        true,
      ),
    );
  });
});

describe('load', () => {
  it('after a restart, loads the stored index from IndexedDB without rebuilding', async () => {
    await seed();
    await rebuildSearchIndex(SRC);
    resetSearchCacheForTests(); // worker restarted (app reopened)
    const list = vi.spyOn(catalogRepo, 'listForSource');
    expect(await warmUpSearch(SRC)).toEqual({ sourceId: SRC, from: 'storage', items: 4 });
    expect(await warmUpSearch(SRC)).toEqual({ sourceId: SRC, from: 'memory', items: 4 });
    expect(list).not.toHaveBeenCalled();
  });

  it('builds on demand when the index is missing', async () => {
    await seed();
    expect(await warmUpSearch(SRC)).toEqual({ sourceId: SRC, from: 'build', items: 4 });
    expect(await catalogRepo.getSearchIndex(SRC)).toBeDefined();
  });

  it('a catalogue write deletes the stored index and drops the loaded one', async () => {
    await seed();
    await rebuildSearchIndex(SRC);
    expect((await warmUpSearch(SRC)).from).toBe('memory');
    await catalogRepo.replaceForExistingSource(SRC, 'series', {
      categories: [],
      items: [{ externalId: '21', name: 'Brand New Show' }],
    });
    expect(await catalogRepo.getSearchIndex(SRC)).toBeUndefined();
    const r = await searchCatalog({ sourceId: SRC, query: 'brand new' });
    expect(r.groups.series.hits.map((h) => h.name)).toEqual(['Brand New Show']);
  });

  it('a type written by a sync that never finished (app killed) is searchable after reopening', async () => {
    await seed();
    await rebuildSearchIndex(SRC);
    // The sync wrote one type, then the app was killed: no finish(), no lastSyncByType update.
    await catalogRepo.replaceForExistingSource(SRC, 'movie', {
      categories: [],
      items: [{ externalId: '99', name: 'Killed Midway Movie', streamPath: '' }],
    });
    resetSearchCacheForTests(); // reopened
    expect((await warmUpSearch(SRC)).from).toBe('build');
    const r = await searchCatalog({ sourceId: SRC, query: 'midway' });
    expect(r.groups.movie.hits.map((h) => h.name)).toEqual(['Killed Midway Movie']);
  });

  it('discards a build that overlapped a catalogue write, then rebuilds from the new data', async () => {
    await seed();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const original = catalogRepo.listForSource.bind(catalogRepo);
    const list = vi.spyOn(catalogRepo, 'listForSource');
    let reading: () => void = () => undefined;
    const started = new Promise<void>((r) => (reading = r));
    // The first build reads the old catalogue, then waits until the write has started.
    list.mockImplementationOnce(async (id, type) => {
      reading();
      const rows = await original(id, type);
      await gate;
      return rows;
    });
    const building = rebuildSearchIndex(SRC);
    await started;
    // Let the build go on as soon as the write has started (before its transaction runs).
    const stop = onCatalogWrite(() => release());
    const writing = catalogRepo.replaceForExistingSource(SRC, 'series', {
      categories: [],
      items: [{ externalId: '22', name: 'Arrived During Build' }],
    });
    await writing;
    stop();
    expect(await building).toBeUndefined();
    expect(await catalogRepo.getSearchIndex(SRC)).toBeUndefined();
    const r = await searchCatalog({ sourceId: SRC, query: 'arrived' });
    expect(r.groups.series.hits.map((h) => h.name)).toEqual(['Arrived During Build']);
  });

  it('rebuilds a stored index that is corrupt or of another version', async () => {
    await seed();
    await rebuildSearchIndex(SRC, () => 1000);
    const entry = await catalogRepo.getSearchIndex(SRC);
    if (!entry) throw new Error('index missing');
    await catalogRepo.putSearchIndex({ ...entry, data: '{broken' });
    resetSearchCacheForTests();
    expect((await warmUpSearch(SRC)).from).toBe('build');

    await catalogRepo.putSearchIndex({ ...entry, version: SEARCH_INDEX_VERSION + 1 });
    resetSearchCacheForTests();
    expect((await warmUpSearch(SRC)).from).toBe('build');
  });

  it('reports "none" for a source that does not exist', async () => {
    expect(await warmUpSearch('missing')).toEqual({ sourceId: 'missing', from: 'none', items: 0 });
  });
});

describe('searchCatalog', () => {
  it('returns hydrated hits grouped by type', async () => {
    await seed();
    const r = await searchCatalog({ sourceId: SRC, query: 'ex' });
    expect(r.groups.live.total).toBe(2);
    expect(r.groups.live.hits).toEqual(
      expect.arrayContaining([
        {
          key: itemKey(SRC, 'live', '1'),
          type: 'live',
          externalId: '1',
          name: 'Example News HD',
          number: 101,
          categoryId: 'news',
          categoryName: 'News',
        },
        {
          key: itemKey(SRC, 'live', '2'),
          type: 'live',
          externalId: '2',
          name: 'Notícias Exemplo',
          number: 102,
          categoryId: 'news',
          categoryName: 'News',
        },
      ]),
    );
    expect(r.groups.movie.hits).toEqual([
      {
        key: itemKey(SRC, 'movie', '10'),
        type: 'movie',
        externalId: '10',
        name: 'Example Movie',
        year: 2024,
        categoryId: 'm1',
        categoryName: 'Action',
      },
    ]);
    expect(r.groups.series.hits).toEqual([
      {
        key: itemKey(SRC, 'series', '20'),
        type: 'series',
        externalId: '20',
        name: 'Example Drama',
        year: 2021,
      },
    ]);
    // Hits never carry stream URLs.
    expect(JSON.stringify(r)).not.toContain('cdn.example.test');
  });

  it('matches channel numbers', async () => {
    await seed();
    const r = await searchCatalog({ sourceId: SRC, query: '102' });
    expect(r.groups.live.hits.map((h) => h.name)).toEqual(['Notícias Exemplo']);
  });

  it('ignores short or invalid queries and clamps the limit', async () => {
    await seed();
    expect((await searchCatalog({ sourceId: SRC, query: 'e' })).groups.live.total).toBe(0);
    expect((await searchCatalog({ sourceId: '', query: 'example' })).groups.live.total).toBe(0);
    const bad = { sourceId: SRC, query: 42 } as unknown as Parameters<typeof searchCatalog>[0];
    expect((await searchCatalog(bad)).groups.movie.total).toBe(0);
    const one = await searchCatalog({ sourceId: SRC, query: 'ex', limit: 0 });
    expect(one.groups.live.hits).toHaveLength(1);
    expect(one.groups.live.total).toBe(2);
  });

  it('filters by type', async () => {
    await seed();
    const r = await searchCatalog({ sourceId: SRC, query: 'example', types: ['movie'] });
    expect(r.groups.live.total).toBe(0);
    expect(r.groups.movie.total).toBe(1);
  });

  it('searches the requested source only, switching the loaded index', async () => {
    await seed(SRC);
    await sourcesRepo.put(source(OTHER));
    await catalogRepo.replaceForSource(OTHER, 'movie', {
      categories: [],
      items: [{ externalId: '1', name: 'Other Example', streamPath: '' }],
    });
    expect(
      (await searchCatalog({ sourceId: OTHER, query: 'example' })).groups.movie.hits.map(
        (h) => h.name,
      ),
    ).toEqual(['Other Example']);
    expect(
      (await searchCatalog({ sourceId: SRC, query: 'example' })).groups.movie.hits.map(
        (h) => h.name,
      ),
    ).toEqual(['Example Movie']);
  });

  it('never logs the query or item names', async () => {
    await seed();
    await searchCatalog({ sourceId: SRC, query: 'secret-query-text' });
    await searchCatalog({ sourceId: SRC, query: 'example' });
    const logged = JSON.stringify(getLogEntries());
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('Example');
    expect(logged).not.toContain('cdn.example.test');
  });
});

describe('protected content (UX-07)', () => {
  beforeEach(async () => {
    await sourcesRepo.put(source(SRC));
    await catalogRepo.replaceAllForExistingSource(SRC, {
      live: {
        categories: [],
        items: [
          { externalId: '1', name: 'Arena Open', streamPath: '' },
          { externalId: '2', name: 'Arena Locked', streamPath: '', drm: true },
        ],
      },
      movie: {
        categories: [],
        items: [{ externalId: '3', name: 'Arena Film', streamPath: '', container: 'dash' }],
      },
      series: { categories: [], items: [] },
    });
  });

  it('hits of protected items are marked', async () => {
    const result = await searchCatalog({ sourceId: SRC, query: 'arena' });
    expect(result.groups.live.hits.map((h) => [h.name, h.protected === true])).toEqual([
      ['Arena Open', false],
      ['Arena Locked', true],
    ]);
    expect(result.groups.movie.hits[0]).toMatchObject({ name: 'Arena Film', protected: true });
  });

  it('hideProtected leaves them out of hits and totals', async () => {
    const result = await searchCatalog({ sourceId: SRC, query: 'arena', hideProtected: true });
    expect(result.groups.live).toEqual({
      total: 1,
      hits: [expect.objectContaining({ name: 'Arena Open' })],
    });
    expect(result.groups.movie).toEqual({ total: 0, hits: [] });
  });
});
