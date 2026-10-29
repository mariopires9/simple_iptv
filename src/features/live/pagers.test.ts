import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  categoryKey,
  favoritesRepo,
  historyRepo,
  itemKey,
  sourcesRepo,
  wipeAll,
  type Category,
} from '@/core/db';
import { LIVE_RECENT_LIMIT, LIVE_VIRTUAL_CATEGORY_IDS } from '@/ui/routes/live';
import { buildCategories } from './categories';
import {
  MAX_VISIBLE_KEY_SETS,
  clearCountCache,
  clearVisibleKeysCache,
  concatPager,
  createPager,
} from './pagers';

const S = 'src';
const cat = (id: string) => categoryKey(S, 'live', id);
const key = (n: number) => itemKey(S, 'live', String(n));

beforeEach(async () => {
  await sourcesRepo.put({
    id: S,
    kind: 'm3u-url',
    name: 'Test',
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  });
  // Categories a (3), b (0), c (4); items interleaved so "All" order ≠ raw item order.
  const layout = ['a', 'c', 'a', 'c', 'c', 'a', 'c'];
  await catalogRepo.replaceForSource(S, 'live', {
    categories: [
      { externalId: 'a', name: 'A' },
      { externalId: 'b', name: 'B' },
      { externalId: 'c', name: 'C' },
    ],
    items: layout.map((c, i) => ({
      externalId: String(i + 1),
      categoryExternalId: c,
      name: `${c}${i + 1}`,
      streamPath: `${i + 1}.ts`,
    })),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearCountCache();
  clearVisibleKeysCache();
  await wipeAll();
});

const names = (list: readonly ({ name: string } | undefined)[]) => list.map((c) => c?.name ?? '');

describe('buildCategories', () => {
  it('puts the virtual categories first, then source categories by original order', () => {
    const source = [
      { key: cat('2'), externalId: '2', name: 'Second', order: 1 },
      { key: cat('1'), externalId: '1', name: 'First', order: 0 },
    ] as Category[];
    expect(buildCategories(source).map((c) => [c.kind, c.id, c.name])).toEqual([
      ['favorites', LIVE_VIRTUAL_CATEGORY_IDS.favorites, 'Favorites'],
      ['recent', LIVE_VIRTUAL_CATEGORY_IDS.recent, 'Recent'],
      ['all', LIVE_VIRTUAL_CATEGORY_IDS.all, 'All'],
      ['source', '1', 'First'],
      ['source', '2', 'Second'],
    ]);
  });

  it('marks only "Favorites" for the star icon of the category navigation (TEC-03)', () => {
    const source = [{ key: cat('1'), externalId: '1', name: 'First', order: 0 }] as Category[];
    expect(
      buildCategories(source).map((c) => [c.id, 'favorite' in c ? c.favorite : undefined]),
    ).toEqual([
      [LIVE_VIRTUAL_CATEGORY_IDS.favorites, true],
      [LIVE_VIRTUAL_CATEGORY_IDS.recent, false],
      [LIVE_VIRTUAL_CATEGORY_IDS.all, false],
      ['1', undefined],
    ]);
  });
});

describe('concatPager ("All")', () => {
  const all = () =>
    concatPager([
      { key: cat('a'), count: 3 },
      { key: cat('b'), count: 0 },
      { key: cat('c'), count: 4 },
    ]);

  it('concatenates the categories in category order', async () => {
    const pager = all();
    expect(pager.total).toBe(7);
    expect(names(await pager.load(0, 100))).toEqual(['a1', 'a3', 'a6', 'c2', 'c4', 'c5', 'c7']);
  });

  it('scan() yields every row in display order, one category at a time (LIV-04)', async () => {
    const batches: string[][] = [];
    await all().scan?.((rows) => batches.push(names([...rows])));
    // The empty category "b" is skipped (count 0).
    expect(batches).toEqual([
      ['a1', 'a3', 'a6'],
      ['c2', 'c4', 'c5', 'c7'],
    ]);
  });

  it('maps a page that spans two categories to the right local offsets', async () => {
    expect(names(await all().load(2, 3))).toEqual(['a6', 'c2', 'c4']);
    expect(names(await all().load(5, 10))).toEqual(['c5', 'c7']);
    expect(await all().load(7, 10)).toEqual([]);
  });
});

describe('createPager', () => {
  const categories = async () => buildCategories(await catalogRepo.listCategories(S, 'live'));
  const pagerFor = async (id: string) => {
    const list = await categories();
    const category = list.find((c) => c.id === id);
    if (!category) throw new Error(id);
    const keys = list.flatMap((c) => (c.kind === 'source' ? [c.key] : []));
    return createPager(category, S, keys);
  };

  describe('hide protected content (UX-07)', () => {
    // c4 is DRM-flagged, a6 is DASH: protected; the rest play.
    beforeEach(async () => {
      const layout = ['a', 'c', 'a', 'c', 'c', 'a', 'c'];
      await catalogRepo.replaceForSource(S, 'live', {
        categories: [
          { externalId: 'a', name: 'A' },
          { externalId: 'b', name: 'B' },
          { externalId: 'c', name: 'C' },
        ],
        items: layout.map((c, i) => ({
          externalId: String(i + 1),
          categoryExternalId: c,
          name: `${c}${i + 1}`,
          streamPath: '',
          streamUrl: `https://s.example.test/${i + 1}`,
          ...(i + 1 === 4 ? { drm: true } : {}),
          ...(i + 1 === 6 ? { container: 'dash' as const } : {}),
        })),
      });
    });
    const hidden = async (id: string) => {
      const list = await categories();
      const category = list.find((c) => c.id === id);
      if (!category) throw new Error(id);
      const keys = list.flatMap((c) => (c.kind === 'source' ? [c.key] : []));
      return createPager(category, S, keys, 1, { hideProtected: true });
    };

    it('off by default: every channel is listed', async () => {
      expect((await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.all)).total).toBe(7);
    });

    it('source categories and "All" count and page only the playable channels', async () => {
      const c = await hidden('c');
      expect(c.total).toBe(3);
      expect(names(await c.load(0, 10))).toEqual(['c2', 'c5', 'c7']);
      expect(await c.locate((await c.load(1, 1))[0]!)).toBe(1);
      const all = await hidden(LIVE_VIRTUAL_CATEGORY_IDS.all);
      expect(all.total).toBe(5);
      expect(names(await all.load(0, 10))).toEqual(['a1', 'a3', 'c2', 'c5', 'c7']);
      const scanned: string[] = [];
      await all.scan?.((rows) => scanned.push(...names([...rows])));
      expect(scanned).toEqual(['a1', 'a3', 'c2', 'c5', 'c7']);
    });

    it('reports how many channels were left out (empty-state message)', async () => {
      expect((await hidden('c')).hidden).toBe(1);
      expect((await hidden(LIVE_VIRTUAL_CATEGORY_IDS.all)).hidden).toBe(2);
      expect((await pagerFor('c')).hidden).toBeUndefined();
    });

    it('a row deleted after the keys were read leaves a hole in place: pages are never short', async () => {
      const c = await hidden('c');
      // c5 leaves the catalogue (a sync in another tab) while the memoised keys still list it.
      const original = catalogRepo.getMany.bind(catalogRepo);
      vi.spyOn(catalogRepo, 'getMany').mockImplementation(async (type, keys) =>
        (await original(type, keys)).filter((row) => row.key !== key(5)),
      );
      const page = await c.load(0, 10);
      expect(page).toHaveLength(3);
      expect(names(page)).toEqual(['c2', '', 'c7']);
      expect(page[1]).toBeUndefined();
    });

    it('the filter scan walks the categories again, without reading rows by key', async () => {
      const all = await hidden(LIVE_VIRTUAL_CATEGORY_IDS.all);
      const byKey = vi.spyOn(catalogRepo, 'getMany');
      const scanned: string[] = [];
      await all.scan?.((rows) => scanned.push(...names([...rows])));
      expect(scanned).toEqual(['a1', 'a3', 'c2', 'c5', 'c7']);
      expect(byKey).not.toHaveBeenCalled();
    });

    it('memoises the playable keys per category (bounded), reading each category once', async () => {
      const walk = vi.spyOn(catalogRepo, 'listByCategory');
      await hidden('a');
      await hidden('c');
      await hidden('a');
      await hidden('c');
      expect(walk).toHaveBeenCalledTimes(2);
      // More categories than kept: the oldest is read again.
      for (let i = 0; i < MAX_VISIBLE_KEY_SETS; i++) {
        await createPager(
          { kind: 'source' as const, id: `x${i}`, key: cat(`x${i}`), name: 'X' },
          S,
          [],
          1,
          { hideProtected: true },
        );
      }
      walk.mockClear();
      await hidden('a');
      expect(walk).toHaveBeenCalledTimes(1);
    });

    it('favorites and recent leave protected channels out', async () => {
      await favoritesRepo.add(key(4), 1);
      await favoritesRepo.add(key(5), 2);
      const favorites = await hidden(LIVE_VIRTUAL_CATEGORY_IDS.favorites);
      expect(names(await favorites.load(0, 10))).toEqual(['c5']);
      await historyRepo.upsert({ itemKey: key(6), lastWatchedAt: 10 });
      await historyRepo.upsert({ itemKey: key(1), lastWatchedAt: 5 });
      const recent = await hidden(LIVE_VIRTUAL_CATEGORY_IDS.recent);
      expect(names(await recent.load(0, 10))).toEqual(['a1']);
    });
  });

  it('a source category pages through its own channels', async () => {
    const pager = await pagerFor('c');
    expect(pager.total).toBe(4);
    expect(names(await pager.load(1, 2))).toEqual(['c4', 'c5']);
  });

  it('"All" counts every categorised channel', async () => {
    expect((await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.all)).total).toBe(7);
  });

  it('"All" memoises the category counts per source sync, recounting after a new sync', async () => {
    const list = await categories();
    const all = list.find((c) => c.kind === 'all');
    if (!all) throw new Error('no All');
    const keys = list.flatMap((c) => (c.kind === 'source' ? [c.key] : []));
    const spy = vi.spyOn(catalogRepo, 'countByCategory');
    expect((await createPager(all, S, keys, 100)).total).toBe(7);
    expect(spy).toHaveBeenCalledTimes(3);
    expect((await createPager(all, S, keys, 100)).total).toBe(7);
    expect(spy).toHaveBeenCalledTimes(3);
    // A sync moved `lastSyncAt`: counted again.
    expect((await createPager(all, S, keys, 200)).total).toBe(7);
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('"All" does not memoise a failed count', async () => {
    const list = await categories();
    const all = list.find((c) => c.kind === 'all');
    if (!all) throw new Error('no All');
    const keys = list.flatMap((c) => (c.kind === 'source' ? [c.key] : []));
    vi.spyOn(catalogRepo, 'countByCategory').mockRejectedValueOnce(new Error('boom'));
    await expect(createPager(all, S, keys, 1)).rejects.toThrow('boom');
    expect((await createPager(all, S, keys, 1)).total).toBe(7);
  });

  it('locate finds a channel with an indexed count, in a category and in "All"', async () => {
    const list = await categories();
    const keys = list.flatMap((c) => (c.kind === 'source' ? [c.key] : []));
    const byId = (id: string) => list.find((c) => c.id === id);
    const items = await catalogRepo.getMany('live', [1, 2, 3, 4, 5, 6, 7].map(key));
    const c = byId('c');
    const all = byId(LIVE_VIRTUAL_CATEGORY_IDS.all);
    if (!c || !all) throw new Error('categories');
    const pagerC = await createPager(c, S, keys);
    const pagerAll = await createPager(all, S, keys);
    // C = c2, c4, c5, c7; All = a1, a3, a6, c2, c4, c5, c7.
    expect(items).toHaveLength(7);
    for (const item of items) {
      const inC = ['c2', 'c4', 'c5', 'c7'].indexOf(item.name);
      expect(await pagerC.locate(item)).toBe(inC);
      expect(await pagerAll.locate(item)).toBe(
        ['a1', 'a3', 'a6', 'c2', 'c4', 'c5', 'c7'].indexOf(item.name),
      );
    }
    const ghost = { ...items[0], key: key(99), order: 99 } as (typeof items)[number];
    expect(await pagerAll.locate(ghost)).toBe(-1);

    // Equivalent to the row order of `load`, with one indexed count and one row read per call.
    const count = vi.spyOn(catalogRepo, 'indexInCategory');
    const read = vi.spyOn(catalogRepo, 'listByCategory');
    const rows = await pagerAll.load(0, pagerAll.total);
    read.mockClear();
    for (const [i, row] of rows.entries()) {
      count.mockClear();
      expect(await pagerAll.locate(row!)).toBe(i);
      expect(count).toHaveBeenCalledTimes(1);
    }
    expect(read).toHaveBeenCalledTimes(rows.length);
    for (const [, , page] of read.mock.calls) expect(page?.limit).toBe(1);
  });

  it('"Favorites" lists favourite channels, most recent first, skipping removed ones', async () => {
    await favoritesRepo.add(key(1), 1);
    await favoritesRepo.add(key(4), 2);
    await favoritesRepo.add(itemKey(S, 'live', 'gone'), 3);
    const pager = await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.favorites);
    expect(pager.total).toBe(2);
    expect(names(await pager.load(0, 10))).toEqual(['c4', 'a1']);
  });

  it('"Recent" lists watched channels, most recent first', async () => {
    await historyRepo.upsert({ itemKey: key(2), lastWatchedAt: 1 });
    await historyRepo.upsert({ itemKey: key(3), lastWatchedAt: 2 });
    const pager = await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.recent);
    expect(names(await pager.load(0, 10))).toEqual(['a3', 'c2']);
  });

  it('"Recent" shows the 30 most recent channels still in the list (FAV-02 AC1)', async () => {
    expect(LIVE_RECENT_LIMIT).toBe(30);
    // 35 newer entries whose channels left the list, then the 7 channels that exist.
    for (let i = 1; i <= 35; i++) {
      await historyRepo.upsert({ itemKey: itemKey(S, 'live', `gone${i}`), lastWatchedAt: 100 + i });
    }
    for (let n = 1; n <= 7; n++) await historyRepo.upsert({ itemKey: key(n), lastWatchedAt: n });
    const pager = await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.recent);
    expect(pager.total).toBe(7);
    expect(names(await pager.load(0, 10))).toEqual(['c7', 'a6', 'c5', 'c4', 'a3', 'c2', 'a1']);

    const spy = vi.spyOn(historyRepo, 'listRecentItems');
    await pagerFor(LIVE_VIRTUAL_CATEGORY_IDS.recent);
    expect(spy).toHaveBeenCalledWith(S, ['live'], { limit: 30 });
  });
});
