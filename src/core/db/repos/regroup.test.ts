// VOD-04 review #1: history and favourites of per-entry M3U series rows move to the grouped show
// and episode keys in the catalogue write; idempotent; nothing else is touched.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase } from '../database';
import { episodeItemKey, itemKey } from '../keys';
import { openFreshDatabase } from '../test-utils';
import type { CatalogReplacementByType } from './catalog';
import { catalogRepo } from './catalog';
import { favoritesRepo } from './favorites';
import { historyRepo } from './history';
import { sourcesRepo } from './sources';

beforeEach(async () => {
  await openFreshDatabase();
  await sourcesRepo.put({
    id: 's1',
    kind: 'm3u-url',
    name: 's1',
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  });
});

afterEach(async () => {
  await closeDatabase();
});

const old = (id: string) => itemKey('s1', 'series', id);
const oldEp = (id: string) => episodeItemKey(old(id), id);
const show = itemKey('s1', 'series', 'show');
const ep = (id: string) => episodeItemKey(show, id);

/** One show `show` with episodes e1, e2, plus a still ungrouped series row `single`. */
const catalog = (): CatalogReplacementByType => ({
  live: { categories: [], items: [] },
  movie: { categories: [], items: [] },
  series: {
    categories: [{ externalId: 'c', name: 'Séries' }],
    items: [
      { externalId: 'show', categoryExternalId: 'c', name: 'Show' },
      { externalId: 'single', categoryExternalId: 'c', name: 'Single S01E01' },
    ],
  },
  seriesDetails: [
    {
      seriesExternalId: 'show',
      seasons: [
        {
          number: 1,
          episodes: ['e1', 'e2', 'single'].map((id, i) => ({
            externalId: id,
            season: 1,
            number: i + 1,
            title: id,
            streamPath: '',
          })),
        },
      ],
    },
  ],
});

describe('regroupUserData (through replaceAllForExistingSource)', () => {
  it('moves episode and series entries; the newest decides the show entry', async () => {
    await historyRepo.set({ itemKey: oldEp('e1'), positionSec: 100, lastWatchedAt: 10 });
    await historyRepo.set({
      itemKey: old('e1'),
      episodeKey: oldEp('e1'),
      positionSec: 100,
      lastWatchedAt: 10,
    });
    await historyRepo.set({
      itemKey: old('e2'),
      episodeKey: oldEp('e2'),
      positionSec: 7,
      lastWatchedAt: 20,
    });
    // A newer entry already on the new episode key wins over the old one.
    await historyRepo.set({ itemKey: ep('e1'), positionSec: 999, lastWatchedAt: 30 });
    // A series row that still exists on its own keeps its data.
    await historyRepo.set({ itemKey: old('single'), positionSec: 5, lastWatchedAt: 40 });

    const result = await catalogRepo.replaceAllForExistingSource('s1', catalog());
    expect(result?.series).toMatchObject({ episodes: 3, regrouped: { history: 3, favorites: 0 } });
    expect(await historyRepo.get(ep('e1'))).toMatchObject({ positionSec: 999 });
    expect(await historyRepo.get(ep('e2'))).toMatchObject({ positionSec: 7, lastWatchedAt: 20 });
    expect(await historyRepo.get(show)).toMatchObject({ episodeKey: ep('e2'), lastWatchedAt: 20 });
    expect(await historyRepo.get(old('single'))).toMatchObject({ positionSec: 5 });
    expect(await historyRepo.get(ep('single'))).toBeUndefined();
    expect(await historyRepo.get(old('e1'))).toBeUndefined();
    expect(await historyRepo.get(oldEp('e1'))).toBeUndefined();

    // Idempotent.
    const again = await catalogRepo.replaceAllForExistingSource('s1', catalog());
    expect(again?.series.regrouped).toEqual({ history: 0, favorites: 0 });
    expect(await historyRepo.get(show)).toMatchObject({ episodeKey: ep('e2') });
  });

  it('favourites: one per show with the earliest date; an existing show favourite is kept', async () => {
    await favoritesRepo.add(show, 30);
    await favoritesRepo.add(old('e1'), 50);
    await favoritesRepo.add(old('e2'), 20);
    await favoritesRepo.add(old('single'), 10);
    const result = await catalogRepo.replaceAllForExistingSource('s1', catalog());
    expect(result?.series.regrouped).toEqual({ history: 0, favorites: 2 });
    const list = await favoritesRepo.list('s1', 'series');
    expect(list.map((f) => [f.itemKey, f.addedAt])).toEqual([
      [show, 20],
      [old('single'), 10],
    ]);
  });

  it('without seriesDetails nothing is moved', async () => {
    await favoritesRepo.add(old('e1'), 50);
    const { seriesDetails: _omit, ...plain } = catalog();
    expect(_omit).toBeDefined();
    await catalogRepo.replaceAllForExistingSource('s1', plain);
    expect(await favoritesRepo.has(old('e1'))).toBe(true);
  });
});
