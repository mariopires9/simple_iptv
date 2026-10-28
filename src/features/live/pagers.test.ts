import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { buildCategories, VIRTUAL_CATEGORY_IDS } from './categories';
import { concatPager, createPager } from './pagers';

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
  await wipeAll();
});

const names = (list: { name: string }[]) => list.map((c) => c.name);

describe('buildCategories', () => {
  it('puts the virtual categories first, then source categories by original order', () => {
    const source = [
      { key: cat('2'), externalId: '2', name: 'Second', order: 1 },
      { key: cat('1'), externalId: '1', name: 'First', order: 0 },
    ] as Category[];
    expect(buildCategories(source).map((c) => [c.kind, c.id, c.name])).toEqual([
      ['favorites', VIRTUAL_CATEGORY_IDS.favorites, 'Favorites'],
      ['recent', VIRTUAL_CATEGORY_IDS.recent, 'Recent'],
      ['all', VIRTUAL_CATEGORY_IDS.all, 'All'],
      ['source', '1', 'First'],
      ['source', '2', 'Second'],
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

  it('a source category pages through its own channels', async () => {
    const pager = await pagerFor('c');
    expect(pager.total).toBe(4);
    expect(names(await pager.load(1, 2))).toEqual(['c4', 'c5']);
  });

  it('"All" counts every categorised channel', async () => {
    expect((await pagerFor(VIRTUAL_CATEGORY_IDS.all)).total).toBe(7);
  });

  it('"Favorites" lists favourite channels, most recent first, skipping removed ones', async () => {
    await favoritesRepo.add(key(1), 1);
    await favoritesRepo.add(key(4), 2);
    await favoritesRepo.add(itemKey(S, 'live', 'gone'), 3);
    const pager = await pagerFor(VIRTUAL_CATEGORY_IDS.favorites);
    expect(pager.total).toBe(2);
    expect(names(await pager.load(0, 10))).toEqual(['c4', 'a1']);
  });

  it('"Recent" lists watched channels, most recent first', async () => {
    await historyRepo.upsert({ itemKey: key(2), lastWatchedAt: 1 });
    await historyRepo.upsert({ itemKey: key(3), lastWatchedAt: 2 });
    const pager = await pagerFor(VIRTUAL_CATEGORY_IDS.recent);
    expect(names(await pager.load(0, 10))).toEqual(['a3', 'c2']);
  });
});
