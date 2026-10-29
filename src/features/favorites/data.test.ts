// FAV-01/FAV-02 data rules: recent channels, "Continue watching", favorites per list (including
// unavailable ones) and the routes the cards link to.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  episodeItemKey,
  favoritesRepo,
  historyRepo,
  itemKey,
  wipeAll,
} from '@/core/db';
import {
  CONTINUE_WATCHING_LIMIT,
  HOME_FAVORITES_LIMIT,
  RECENT_CHANNELS_LIMIT,
  clearHistory,
  loadContinueWatching,
  loadFavorites,
  loadHome,
  loadHomeFavorites,
  loadRecentChannels,
  continueWatching,
} from './data';
import { OTHER, SOURCE, seedCatalog } from './test-utils';

const live = (id: string, source = SOURCE) => itemKey(source, 'live', id);
const movie = (id: string, source = SOURCE) => itemKey(source, 'movie', id);
const series = (id: string) => itemKey(SOURCE, 'series', id);

beforeEach(async () => {
  await seedCatalog();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await wipeAll();
});

describe('recent channels (FAV-02 AC1)', () => {
  it('newest first, at most 30, no duplicates, only the active list', async () => {
    for (let i = 1; i <= 35; i++) {
      await historyRepo.upsert({ itemKey: live(`c${i}`), lastWatchedAt: i });
    }
    // Watched again: moves to the front, still once.
    await historyRepo.upsert({ itemKey: live('c3'), lastWatchedAt: 100 });
    await historyRepo.upsert({ itemKey: live('o1', OTHER), lastWatchedAt: 200 });

    const recent = await loadRecentChannels(SOURCE);
    expect(recent).toHaveLength(RECENT_CHANNELS_LIMIT);
    expect(recent.map((c) => c.name).slice(0, 3)).toEqual([
      'Channel 3',
      'Channel 35',
      'Channel 34',
    ]);
    expect(new Set(recent.map((c) => c.key)).size).toBe(recent.length);
    expect(recent.some((c) => c.key === live('o1', OTHER))).toBe(false);
  });

  it('skips channels that are no longer in the list', async () => {
    await historyRepo.upsert({ itemKey: live('gone'), lastWatchedAt: 2 });
    await historyRepo.upsert({ itemKey: live('c1'), lastWatchedAt: 1 });
    expect((await loadRecentChannels(SOURCE)).map((c) => c.name)).toEqual(['Channel 1']);
  });
});

describe('continue watching (FAV-02 AC2)', () => {
  it.each([
    [{ positionSec: 59, durationSec: 6000 }, false],
    [{ positionSec: 60, durationSec: 6000 }, true],
    [{ positionSec: 5640, durationSec: 6000 }, true], // 94 %
    [{ positionSec: 5700, durationSec: 6000 }, true], // 95 %: still resumable (VOD-03)
    [{ positionSec: 5760, durationSec: 6000 }, false], // 96 %
    [{ positionSec: 600, durationSec: 6000, completed: true }, false],
    // Unknown duration: resumable, as on the movie details (VOD-03).
    [{ positionSec: 600 }, true],
    [{ positionSec: 600, durationSec: 0 }, true],
  ])('movie %o → in Continue watching: %s', (fields, expected) => {
    const entry = {
      itemKey: movie('m1'),
      sourceId: SOURCE,
      type: 'movie' as const,
      lastWatchedAt: 1,
      completed: false,
      ...fields,
    };
    expect(continueWatching(entry) !== undefined).toBe(expected);
  });

  it.each([
    ['in progress', { episodeKey: 'e', positionSec: 300, durationSec: 1200 }, 0.25],
    ['moved on to the next episode', { episodeKey: 'e', positionSec: 0 }, undefined],
    ['at the 1 min minimum', { episodeKey: 'e', positionSec: 60, durationSec: 1200 }, 0.05],
  ] as const)('series %s → shown, progress %s', (_, fields, fraction) => {
    const entry = {
      itemKey: series('s1'),
      sourceId: SOURCE,
      type: 'series' as const,
      lastWatchedAt: 1,
      completed: false,
      ...fields,
    };
    expect(continueWatching(entry)).toEqual({ fraction });
  });

  it.each([
    ['finished (last episode)', { episodeKey: 'e', completed: true }],
    // VOD-03 minimum: a few seconds of an episode do not put the series in the row.
    ['just started (10 s)', { episodeKey: 'e', positionSec: 10, durationSec: 1200 }],
    ['below 1 min', { episodeKey: 'e', positionSec: 59, durationSec: 1200 }],
    // TEC-03: the shared rule (`continueWatchingProgress`) — beyond 95 % is not resumable.
    ['beyond 95 %', { episodeKey: 'e', positionSec: 1150, durationSec: 1200 }],
    ['no position', { episodeKey: 'e' }],
    ['no episode', {}],
  ])('series %s → not shown', (_, fields) => {
    const entry = {
      itemKey: series('s1'),
      sourceId: SOURCE,
      type: 'series' as const,
      lastWatchedAt: 1,
      completed: false,
      ...fields,
    };
    expect(continueWatching(entry)).toBeUndefined();
    expect(
      continueWatching({
        ...entry,
        itemKey: episodeItemKey(series('s1'), '1'),
        episodeKey: undefined,
      }),
    ).toBeUndefined();
  });

  it('movies and episodes with progress, newest first, at most 20, with the progress', async () => {
    for (let i = 1; i <= 25; i++) {
      await historyRepo.upsert({
        itemKey: movie(`m${i}`),
        positionSec: 600,
        durationSec: 6000,
        lastWatchedAt: i,
      });
    }
    await historyRepo.upsert({ itemKey: movie('m26'), positionSec: 30, durationSec: 6000 });
    await historyRepo.upsert({
      itemKey: movie('m27'),
      positionSec: 5990,
      durationSec: 6000,
      completed: true,
    });
    await catalogRepo.putSeriesDetails({
      seriesKey: series('s2'),
      sourceId: SOURCE,
      fetchedAt: 1,
      seasons: [
        {
          number: 2,
          episodes: [
            { key: 'ep-5', externalId: '5', season: 2, number: 4, title: 'E', streamPath: '' },
          ],
        },
      ],
    });
    await historyRepo.upsert({
      itemKey: series('s2'),
      episodeKey: 'ep-5',
      positionSec: 300,
      durationSec: 1200,
      lastWatchedAt: 1_000,
    });

    const cards = await loadContinueWatching(SOURCE);
    expect(cards).toHaveLength(CONTINUE_WATCHING_LIMIT);
    expect(cards[0]).toMatchObject({
      name: 'Show 2',
      href: '/series/s2',
      progress: 0.25,
      episode: { season: 2, number: 4 },
    });
    expect(cards[1]).toMatchObject({ name: 'Movie 25', href: '/movies/m25', progress: 0.1 });
    expect(cards.map((c) => c.name)).not.toContain('Movie 26');
    expect(cards.map((c) => c.name)).not.toContain('Movie 27');
  });
});

describe('continue watching — series episodes (SER-02/03)', () => {
  it('one card per series from its entry; per-episode entries are skipped', async () => {
    const episode = episodeItemKey(series('s2'), '40102');
    await catalogRepo.putSeriesDetails({
      seriesKey: series('s2'),
      sourceId: SOURCE,
      fetchedAt: 1,
      seasons: [
        {
          number: 1,
          episodes: [
            { key: episode, externalId: '40102', season: 1, number: 2, title: 'E', streamPath: '' },
          ],
        },
      ],
    });
    // What the series player writes: the episode's own entry, then the series entry.
    await historyRepo.upsert({
      itemKey: episode,
      positionSec: 300,
      durationSec: 1200,
      lastWatchedAt: 10,
    });
    await historyRepo.upsert({
      itemKey: series('s2'),
      episodeKey: episode,
      positionSec: 300,
      durationSec: 1200,
      lastWatchedAt: 10,
    });
    const getMany = vi.spyOn(catalogRepo, 'getMany');
    const cards = await loadContinueWatching(SOURCE);
    expect(cards).toEqual([
      expect.objectContaining({
        href: '/series/s2',
        progress: 0.25,
        episode: { season: 1, number: 2 },
      }),
    ]);
    // The episode key is never looked up as a catalogue item.
    expect(getMany.mock.calls.flatMap(([, keys]) => keys)).not.toContain(episode);
  });
});

describe('continue watching — finished episode (SER-03 review #1)', () => {
  it('a series with only a few seconds of its first episode is not shown (VOD-03 minimum)', async () => {
    const e1 = episodeItemKey(series('s2'), '1');
    await historyRepo.upsert({ itemKey: e1, positionSec: 10, durationSec: 1200 });
    await historyRepo.set({
      itemKey: series('s2'),
      episodeKey: e1,
      positionSec: 10,
      durationSec: 1200,
    });
    expect(await loadContinueWatching(SOURCE)).toEqual([]);
    await historyRepo.set({
      itemKey: series('s2'),
      episodeKey: e1,
      positionSec: 90,
      durationSec: 1200,
    });
    expect((await loadContinueWatching(SOURCE)).map((c) => c.href)).toEqual(['/series/s2']);
  });

  it('a series whose episode was finished stays, on its next episode', async () => {
    const e1 = episodeItemKey(series('s2'), '1');
    const e2 = episodeItemKey(series('s2'), '2');
    await catalogRepo.putSeriesDetails({
      seriesKey: series('s2'),
      sourceId: SOURCE,
      fetchedAt: 1,
      seasons: [
        {
          number: 1,
          episodes: [
            { key: e1, externalId: '1', season: 1, number: 1, title: 'A', streamPath: '' },
            { key: e2, externalId: '2', season: 1, number: 2, title: 'B', streamPath: '' },
          ],
        },
      ],
    });
    // The writes of features/series `saveEpisodeProgress` when E1 is finished and E2 follows:
    // E1's own entry completed, the series entry (written exactly) pointing at E2 from 0.
    await historyRepo.upsert({
      itemKey: e1,
      positionSec: 1190,
      durationSec: 1200,
      completed: true,
    });
    await historyRepo.set({ itemKey: series('s2'), episodeKey: e2, positionSec: 0 });
    const cards = await loadContinueWatching(SOURCE);
    expect(cards).toEqual([
      expect.objectContaining({
        href: '/series/s2',
        progress: undefined,
        episode: { season: 1, number: 2 },
      }),
    ]);
  });
});

describe('favorites (FAV-01)', () => {
  it('only the active list; an item that left the list is unavailable (AC2, AC3)', async () => {
    await favoritesRepo.add(live('c2'), 1);
    await favoritesRepo.add(live('gone'), 2);
    await favoritesRepo.add(live('o1', OTHER), 3);
    const entries = await loadFavorites(SOURCE, 'live');
    expect(entries.map((e) => [e.favorite.itemKey, e.card?.name])).toEqual([
      [live('gone'), undefined],
      [live('c2'), 'Channel 2'],
    ]);
    expect((await loadFavorites(OTHER, 'live')).map((e) => e.card?.name)).toEqual([
      'Other channel',
    ]);
  });

  it('survive a re-sync: back when the item returns, unavailable while it is missing', async () => {
    await favoritesRepo.add(movie('m1'));
    await catalogRepo.replaceForSource(SOURCE, 'movie', {
      categories: [],
      items: [{ externalId: 'm2', name: 'Movie 2', streamPath: '' }],
    });
    expect((await loadFavorites(SOURCE, 'movie')).map((e) => e.card)).toEqual([undefined]);
    await catalogRepo.replaceForSource(SOURCE, 'movie', {
      categories: [],
      items: [{ externalId: 'm1', name: 'Movie 1', streamPath: '' }],
    });
    expect((await loadFavorites(SOURCE, 'movie')).map((e) => e.card?.name)).toEqual(['Movie 1']);
  });

  it('Home: every type, most recently added first, available ones only, at most 20', async () => {
    await favoritesRepo.add(series('s1'), 3);
    await favoritesRepo.add(live('c1'), 2);
    await favoritesRepo.add(movie('gone'), 4);
    for (let i = 1; i <= 20; i++) await favoritesRepo.add(movie(`m${i}`), 1 - i);
    const cards = await loadHomeFavorites(SOURCE);
    expect(cards).toHaveLength(HOME_FAVORITES_LIMIT);
    expect(cards.map((c) => c.name).slice(0, 3)).toEqual(['Show 1', 'Channel 1', 'Movie 1']);
  });
});

describe('card routes (FAV-03)', () => {
  it('channel in its category (or All), movie and series details, encoded', async () => {
    await favoritesRepo.add(live('c1'), 3);
    await favoritesRepo.add(live('nc'), 2);
    await favoritesRepo.add(movie('m1'), 1);
    await favoritesRepo.add(series('s1'), 0);
    const cards = await loadHomeFavorites(SOURCE);
    expect(cards.map((c) => c.href)).toEqual([
      `/live/category/10?channel=${encodeURIComponent(live('c1'))}`,
      `/live/category/~all?channel=${encodeURIComponent(live('nc'))}`,
      '/movies/m1',
      '/series/s1',
    ]);
  });
});

describe('clear history (FAV-02 AC3)', () => {
  it('removes recent channels and progress of the active list, keeps favorites', async () => {
    await historyRepo.upsert({ itemKey: live('c1') });
    await historyRepo.upsert({ itemKey: movie('m1'), positionSec: 600, durationSec: 6000 });
    await historyRepo.upsert({ itemKey: live('o1', OTHER) });
    await favoritesRepo.add(movie('m2'));
    expect(await loadHome(SOURCE)).toMatchObject({ hasHistory: true });

    await clearHistory(SOURCE);
    const home = await loadHome(SOURCE);
    expect(home).toMatchObject({ continueWatching: [], recentChannels: [], hasHistory: false });
    expect(home.favorites.map((c) => c.name)).toEqual(['Movie 2']);
    expect(await loadRecentChannels(OTHER)).toHaveLength(1);
  });
});
