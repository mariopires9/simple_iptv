import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogRepo, categoryKey, wipeAll, type CatalogItemInput } from '@/core/db';
import {
  clearProjectionCache,
  isSortMode,
  loadProjection,
  readProjection,
  sortedKeys,
  type SortRow,
} from './sortIndex';

const row = (key: string, name: string, pos: number, extra: Partial<SortRow> = {}): SortRow => ({
  key,
  name,
  addedAt: undefined,
  rating: undefined,
  pos,
  protected: false,
  ...extra,
});

describe('sortedKeys — hide protected content (UX-07)', () => {
  const rows: SortRow[] = [
    row('a', 'Alpha', 0, { protected: true }),
    row('b', 'Bravo', 1),
    row('c', 'Charlie', 2, { protected: true }),
    row('d', 'Delta', 3),
  ];

  it('leaves protected rows out only when asked, so the grid total counts what is shown', () => {
    expect(sortedKeys(rows, 'name', 'en')).toEqual(['a', 'b', 'c', 'd']);
    expect(sortedKeys(rows, 'name', 'en', true)).toEqual(['b', 'd']);
    expect(sortedKeys(rows, 'added', 'en', true)).toEqual(['b', 'd']);
    // Memoised per setting: switching back is not served the filtered list.
    expect(sortedKeys(rows, 'name', 'en', false)).toHaveLength(4);
  });
});

describe('sortedKeys (VOD-01 AC2)', () => {
  const rows: SortRow[] = [
    row('a', 'Movie 10', 0, { addedAt: 100, rating: 6 }),
    row('b', 'movie 2', 1, { addedAt: 300 }),
    row('c', 'Ámelie', 2, { rating: 9 }),
    row('d', 'Zed', 3, { addedAt: 300, rating: 6 }),
    row('e', 'Brazil', 4),
  ];

  it('recently added: newest first, ties and undated movies in source order', () => {
    expect(sortedKeys(rows, 'added', 'en')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('A–Z: accent/case-insensitive and numeric-aware', () => {
    expect(sortedKeys(rows, 'name', 'en')).toEqual(['c', 'e', 'b', 'a', 'd']);
  });

  it('rating: highest first, ties in source order, unrated last', () => {
    expect(sortedKeys(rows, 'rating', 'en')).toEqual(['c', 'a', 'd', 'b', 'e']);
  });

  it('is memoised per rows array, mode and locale', () => {
    expect(sortedKeys(rows, 'name', 'en')).toBe(sortedKeys(rows, 'name', 'en'));
    expect(sortedKeys(rows, 'name', 'pt-PT')).not.toBe(sortedKeys(rows, 'name', 'en'));
  });

  it('isSortMode', () => {
    expect(isSortMode('rating')).toBe(true);
    expect(isSortMode('price')).toBe(false);
    expect(isSortMode(null)).toBe(false);
  });
});

describe('projection over IndexedDB', () => {
  const items: CatalogItemInput<'movie'>[] = Array.from({ length: 25 }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: i < 20 ? '1' : '2',
    name: `Movie ${i + 1}`,
    streamPath: `${i + 1}.mp4`,
    plot: 'A long plot that the projection must not keep',
    ...(i === 3 ? { rating: 7 } : {}),
    ...(i % 2 === 0 ? { addedAt: 1000 + i } : {}),
  }));
  const k1 = categoryKey('s1', 'movie', '1');
  const k2 = categoryKey('s1', 'movie', '2');

  beforeAll(async () => {
    await catalogRepo.replaceForSource('s1', 'movie', {
      categories: [
        { externalId: '1', name: 'One' },
        { externalId: '2', name: 'Two' },
      ],
      items,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearProjectionCache();
  });
  afterAll(async () => {
    await wipeAll();
  });

  it('reads each category once through the [categoryKey+order] index, keeping only sort fields', async () => {
    const spy = vi.spyOn(catalogRepo, 'listByCategory');
    const projection = await readProjection('movie', [k2, k1]);
    expect(projection.rows).toHaveLength(25);
    // "All": category order, then the source order inside each category.
    expect(projection.rows.slice(0, 6).map((r) => r.name)).toEqual([
      'Movie 21',
      'Movie 22',
      'Movie 23',
      'Movie 24',
      'Movie 25',
      'Movie 1',
    ]);
    expect(projection.rows.map((r) => r.pos)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(Object.keys(projection.rows[0] ?? {}).sort()).toEqual([
      'addedAt',
      'key',
      'name',
      'pos',
      'protected',
      'rating',
    ]);
    expect(projection.hasRatings).toBe(true);
    expect(spy.mock.calls).toEqual([
      ['movie', k2],
      ['movie', k1],
    ]);
  });

  it('hasRatings is false when no movie of the categories is rated', async () => {
    expect((await readProjection('movie', [k2])).hasRatings).toBe(false);
  });

  it('loadProjection is memoised per (source, sync, categories); a new sync reads again', async () => {
    const spy = vi.spyOn(catalogRepo, 'listByCategory');
    const first = await loadProjection('movie', 's1', 1, [k1]);
    expect(await loadProjection('movie', 's1', 1, [k1])).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await loadProjection('movie', 's1', 2, [k1])).not.toBe(first);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a failed read is not memoised', async () => {
    vi.spyOn(catalogRepo, 'listByCategory').mockRejectedValueOnce(new Error('boom'));
    await expect(loadProjection('movie', 's1', 1, [k1])).rejects.toThrow('boom');
    expect((await loadProjection('movie', 's1', 1, [k1])).rows).toHaveLength(20);
  });
});

describe('readProjection — series (SER-01)', () => {
  afterAll(async () => {
    await wipeAll();
  });

  it('reads the series table; series have no addedAt, so "added" keeps the source order', async () => {
    await catalogRepo.replaceForSource('s2', 'series', {
      categories: [{ externalId: '1', name: 'One' }],
      items: [
        { externalId: 'b', categoryExternalId: '1', name: 'Bravo', rating: 5 },
        { externalId: 'a', categoryExternalId: '1', name: 'Alpha' },
      ],
    });
    const projection = await readProjection('series', [categoryKey('s2', 'series', '1')]);
    expect(projection.rows.map((r) => [r.name, r.addedAt])).toEqual([
      ['Bravo', undefined],
      ['Alpha', undefined],
    ]);
    expect(projection.hasRatings).toBe(true);
    expect(sortedKeys(projection.rows, 'added', 'en')).toEqual(['s2:series:b', 's2:series:a']);
    expect(sortedKeys(projection.rows, 'name', 'en')).toEqual(['s2:series:a', 's2:series:b']);
  });
});
