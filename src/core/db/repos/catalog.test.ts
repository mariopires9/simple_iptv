import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDb } from '../database';
import { categoryKey, itemKey } from '../keys';
import { openFreshDatabase } from '../test-utils';
import type { CatalogItemInput, CategoryInput } from '../types';
import { catalogRepo } from './catalog';
import { sourcesRepo } from './sources';

beforeEach(async () => {
  await openFreshDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

const cats = (n: number, prefix = 'Cat'): CategoryInput[] =>
  Array.from({ length: n }, (_, i) => ({ externalId: String(i + 1), name: `${prefix} ${i + 1}` }));

function channels(n: number, catCount = 10, tag = ''): CatalogItemInput<'live'>[] {
  return Array.from({ length: n }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: String((i % catCount) + 1),
    name: `Channel ${tag}${i + 1}`,
    streamPath: `${i + 1}.ts`,
  }));
}

function movies(n: number): CatalogItemInput<'movie'>[] {
  return Array.from({ length: n }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: '1',
    name: `Movie ${i + 1}`,
    streamPath: `${i + 1}.mp4`,
  }));
}

describe('catalogRepo.replaceForSource (CA3)', () => {
  it('writes categories and items with composite keys, order and normalized name', async () => {
    const res = await catalogRepo.replaceForSource('s1', 'live', {
      categories: [
        { externalId: '9', name: 'Sports' },
        { externalId: '3', name: 'News' },
      ],
      items: [
        { externalId: '20', categoryExternalId: '3', name: 'RTP Café', streamPath: '20.ts' },
        { externalId: '10', categoryExternalId: '3', name: 'SIC', streamPath: '10.ts' },
        { externalId: '30', name: 'Uncategorized', streamPath: '30.ts' },
      ],
    });
    expect(res).toEqual({ categories: 2, items: 3, duplicates: 0 });

    const list = await catalogRepo.listCategories('s1', 'live');
    expect(list.map((c) => [c.key, c.name, c.order])).toEqual([
      ['s1:live:cat:9', 'Sports', 0],
      ['s1:live:cat:3', 'News', 1],
    ]);

    const ch = await catalogRepo.get('live', 's1:live:20');
    expect(ch).toMatchObject({
      key: 's1:live:20',
      sourceId: 's1',
      type: 'live',
      externalId: '20',
      categoryKey: 's1:live:cat:3',
      nameNorm: 'rtp cafe',
      order: 0,
    });
    expect(ch).not.toHaveProperty('categoryExternalId');
    expect(await catalogRepo.get('live', 's1:live:30')).not.toHaveProperty('categoryKey');
  });

  it('removes the old items of the source+type and does not touch other types or sources', async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(2),
      items: channels(50, 2),
    });
    await catalogRepo.replaceForSource('s1', 'movie', { categories: cats(1), items: movies(7) });
    await catalogRepo.replaceForSource('s2', 'live', {
      categories: cats(3),
      items: channels(40, 3),
    });

    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(1, 'New'),
      items: channels(5, 1, 'v2-'),
    });

    expect(await catalogRepo.count('s1', 'live')).toBe(5);
    expect(await catalogRepo.get('live', itemKey('s1', 'live', 6))).toBeUndefined();
    expect((await catalogRepo.listCategories('s1', 'live')).map((c) => c.name)).toEqual(['New 1']);
    expect((await catalogRepo.get('live', 's1:live:1'))?.name).toBe('Channel v2-1');

    expect(await catalogRepo.count('s1', 'movie')).toBe(7);
    expect(await catalogRepo.listCategories('s1', 'movie')).toHaveLength(1);
    expect(await catalogRepo.count('s2', 'live')).toBe(40);
    expect(await catalogRepo.listCategories('s2', 'live')).toHaveLength(3);
  });

  it('duplicate keys: the last one wins and counts reflect what was written', async () => {
    const res = await catalogRepo.replaceForSource('s1', 'live', {
      categories: [
        { externalId: '1', name: 'A' },
        { externalId: '1', name: 'A (repeated)' },
      ],
      items: [
        { externalId: '1', categoryExternalId: '1', name: 'First', streamPath: 'a.ts' },
        { externalId: '2', categoryExternalId: '1', name: 'Other', streamPath: 'b.ts' },
        { externalId: '1', categoryExternalId: '1', name: 'Last', streamPath: 'c.ts' },
      ],
    });
    expect(res).toEqual({ categories: 1, items: 2, duplicates: 1 });
    expect(await catalogRepo.count('s1', 'live')).toBe(res.items);
    expect(await catalogRepo.get('live', 's1:live:1')).toMatchObject({ name: 'Last', order: 2 });
    expect((await catalogRepo.listCategories('s1', 'live')).map((c) => c.name)).toEqual([
      'A (repeated)',
    ]);
    const list = await catalogRepo.listByCategory('live', categoryKey('s1', 'live', 1));
    expect(list.map((c) => c.name)).toEqual(['Other', 'Last']);
  });

  it('a failure mid-transaction leaves the old data intact', async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(2),
      items: channels(100, 2),
    });

    const db = await getDb();
    // The repository uses the instance returned by `db.table()` (distinct from `db.channels` in Dexie).
    const table = db.table('channels');
    const original = table.bulkPut.bind(table);
    // Writes the batch (after the categories and old items were deleted) and only then fails.
    const spy = vi.spyOn(table, 'bulkPut').mockImplementation((...args) =>
      original(...(args as Parameters<typeof original>)).then(() => {
        throw new Error('simulated failure');
      }),
    );

    await expect(
      catalogRepo.replaceForSource('s1', 'live', {
        categories: cats(1, 'New'),
        items: channels(60, 1, 'v2-'),
      }),
    ).rejects.toThrow('simulated failure');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    expect(await catalogRepo.count('s1', 'live')).toBe(100);
    expect((await catalogRepo.get('live', 's1:live:1'))?.name).toBe('Channel 1');
    expect((await catalogRepo.listCategories('s1', 'live')).map((c) => c.name)).toEqual([
      'Cat 1',
      'Cat 2',
    ]);
  });

  it('replaces 100 000 items in a single transaction', async () => {
    const N = 100_000;
    const db = await getDb();
    const txSpy = vi.spyOn(db, 'transaction');

    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(50),
      items: channels(N, 50),
    });
    await catalogRepo.replaceForSource('s2', 'live', {
      categories: cats(1),
      items: channels(3, 1),
    });
    txSpy.mockClear();

    const t0 = performance.now();
    const res = await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(50, 'New'),
      items: channels(N, 50, 'v2-'),
    });
    const ms = Math.round(performance.now() - t0);
    // Measurement recorded in the story report (fake-indexeddb on Node; not representative of a browser).
    process.stdout.write(`[FND-05] replaceForSource 100k (fake-indexeddb): ${ms} ms\n`);

    expect(res).toEqual({ categories: 50, items: N, duplicates: 0 });
    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(await catalogRepo.count('s1', 'live')).toBe(N);
    expect((await catalogRepo.get('live', 's1:live:100000'))?.name).toBe('Channel v2-100000');
    expect(await catalogRepo.count('s2', 'live')).toBe(3);
  }, 60_000);
});

describe('catalogRepo — queries', () => {
  beforeEach(async () => {
    await catalogRepo.replaceForSource('s1', 'live', {
      categories: cats(3),
      items: channels(30, 3),
    });
  });

  it('lists items of a category in original order, with pagination', async () => {
    const cat = categoryKey('s1', 'live', 2);
    const all = await catalogRepo.listByCategory('live', cat);
    expect(all.map((c) => c.externalId)).toEqual([
      '2',
      '5',
      '8',
      '11',
      '14',
      '17',
      '20',
      '23',
      '26',
      '29',
    ]);
    const page = await catalogRepo.listByCategory('live', cat, { offset: 2, limit: 3 });
    expect(page.map((c) => c.externalId)).toEqual(['8', '11', '14']);
    expect(await catalogRepo.countByCategory('live', cat)).toBe(10);
  });

  it('indexInCategory is the position of an item in its category (one indexed count)', async () => {
    const cat = categoryKey('s1', 'live', 2);
    const items = await catalogRepo.listByCategory('live', cat);
    const db = await getDb();
    const where = vi.spyOn(db.table('channels'), 'where');
    for (const [i, item] of items.entries()) {
      expect(await catalogRepo.indexInCategory('live', cat, item.order)).toBe(i);
    }
    expect(where).toHaveBeenCalledWith('[categoryKey+order]');
    expect(await catalogRepo.indexInCategory('live', cat, Number.MAX_SAFE_INTEGER)).toBe(10);
    expect(await catalogRepo.indexInCategory('live', 'garbage', 3)).toBe(0);
    expect(await catalogRepo.indexInCategory('movie', cat, 3)).toBe(0);
  });

  it('pagination uses the [categoryKey+order] index and only reads the requested page', async () => {
    const db = await getDb();
    const table = db.table('channels');
    const where = vi.spyOn(table, 'where');
    const cat = categoryKey('s1', 'live', 1);
    const page = await catalogRepo.listByCategory('live', cat, { offset: 9, limit: 5 });
    expect(page.map((c) => c.externalId)).toEqual(['28']); // 10 items in the category: only 1 left
    expect(where).toHaveBeenCalledWith('[categoryKey+order]');
  });

  it('an invalid category key or one of another type returns empty', async () => {
    expect(await catalogRepo.listByCategory('movie', categoryKey('s1', 'live', 2))).toEqual([]);
    expect(await catalogRepo.listByCategory('live', 'garbage')).toEqual([]);
    expect(await catalogRepo.countByCategory('live', 'garbage')).toBe(0);
  });

  it('getMany preserves order and omits missing keys', async () => {
    const list = await catalogRepo.getMany('live', ['s1:live:3', 's1:live:999', 's1:live:1']);
    expect(list.map((c) => c.externalId)).toEqual(['3', '1']);
  });

  it('getCategory, series details and search index', async () => {
    expect((await catalogRepo.getCategory('s1:live:cat:1'))?.name).toBe('Cat 1');
    await catalogRepo.putSeriesDetails({
      seriesKey: 's1:series:7',
      sourceId: 's1',
      fetchedAt: 1,
      seasons: [{ number: 1, episodes: [] }],
    });
    expect((await catalogRepo.getSeriesDetails('s1:series:7'))?.seasons).toHaveLength(1);
    await catalogRepo.putSearchIndex({ sourceId: 's1', data: '{}', builtAt: 2 });
    expect((await catalogRepo.getSearchIndex('s1'))?.builtAt).toBe(2);
  });
});

describe('catalogRepo.replaceForExistingSource (SRC-07 review)', () => {
  const putSource = (id: string) =>
    sourcesRepo.put({
      id,
      kind: 'xtream',
      name: id,
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });

  it('writes when the source exists', async () => {
    await putSource('s1');
    const result = await catalogRepo.replaceForExistingSource('s1', 'live', {
      categories: cats(2),
      items: channels(5, 2),
    });
    expect(result).toEqual({ categories: 2, items: 5, duplicates: 0 });
    expect(await catalogRepo.count('s1', 'live')).toBe(5);
  });

  it('writes nothing and returns undefined when the source row is gone', async () => {
    const result = await catalogRepo.replaceForExistingSource('ghost', 'live', {
      categories: cats(2),
      items: channels(5, 2),
    });
    expect(result).toBeUndefined();
    expect(await catalogRepo.count('ghost', 'live')).toBe(0);
    expect(await catalogRepo.listCategories('ghost', 'live')).toEqual([]);
  });

  it('a removal racing the write never leaves orphan rows', async () => {
    await putSource('s1');
    const write = catalogRepo.replaceForExistingSource('s1', 'movie', {
      categories: cats(3),
      items: movies(2_000),
    });
    const removal = sourcesRepo.remove('s1');
    await Promise.all([write, removal]);
    expect(await catalogRepo.count('s1', 'movie')).toBe(0);
    expect(await catalogRepo.listCategories('s1', 'movie')).toEqual([]);
  });
});
