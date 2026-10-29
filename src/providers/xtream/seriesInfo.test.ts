// SER-02 AC1/AC2/AC5: `get_series_info` normalisation (episodes as object-by-season, array of
// seasons, flat array, object of objects; missing metadata).
import { describe, expect, it, vi } from 'vitest';
import { xtreamFixtures } from '@/test/msw';
import { MAX_EPISODES, episodeTitle, fetchSeriesInfo, parseSeriesInfo } from './seriesInfo';

const shape = (info: ReturnType<typeof parseSeriesInfo>) =>
  info?.seasons.map((s) => ({
    number: s.number,
    name: s.name,
    episodes: s.episodes.map((e) => [e.externalId, e.season, e.number]),
  }));

describe('parseSeriesInfo', () => {
  it('episodes keyed by season (object): seasons in order, episodes by number, metadata', () => {
    const info = parseSeriesInfo(xtreamFixtures.seriesInfoEpisodesObject);
    expect(shape(info)).toEqual([
      {
        number: 1,
        name: 'Season 1',
        episodes: [
          ['40101', 1, 1],
          ['40102', 1, 2],
        ],
      },
      { number: 2, name: 'Season 2', episodes: [['40201', 2, 1]] },
    ]);
    expect(info?.seasons[0]?.cover).toBe('http://img.example.test/seasons/3001-1.jpg');
    // An empty cover is omitted, not an empty string.
    expect(info?.seasons[1]).not.toHaveProperty('cover');
    expect(info?.seasons[0]?.episodes[1]).toEqual({
      externalId: '40102',
      season: 1,
      number: 2,
      title: 'Episódio 2',
      ext: 'mkv',
      durationSec: 5,
      plot: 'Episode 2 of season 1.',
      image: 'http://img.example.test/episodes/3001-1-2.jpg',
    });
    expect(info?.info).toEqual({
      plot: 'Synthetic plot for Example Drama.',
      genre: 'Drama',
      director: 'Carol Placeholder',
      cast: 'Alice Example, Bob Sample',
      year: 2024,
      rating: 8.2,
      cover: 'http://img.example.test/covers/3001.jpg',
      backdrop: 'http://img.example.test/backdrops/3001.jpg',
    });
  });

  it('episodes as an array of seasons, without season metadata', () => {
    const info = parseSeriesInfo(xtreamFixtures.seriesInfoEpisodesArray);
    expect(shape(info)).toEqual([
      {
        number: 1,
        name: undefined,
        episodes: [
          ['50101', 1, 1],
          ['50102', 1, 2],
        ],
      },
      { number: 2, name: undefined, episodes: [['50201', 2, 1]] },
    ]);
  });

  it('a flat episode list, out of order, with numbers as strings and missing fields', () => {
    const info = parseSeriesInfo({
      info: [],
      seasons: [],
      episodes: [
        { id: '9', episode_num: '2', season: '3', title: 'S03E02' },
        { id: 8, episode_num: 1, season: 3 },
        { id: '7', season: '1', title: 'Pilot', info: [] },
        { id: 'not-a-number', season: 1 },
        { id: '8', season: 3, episode_num: 9 }, // duplicate id
        null,
      ],
    });
    expect(shape(info)).toEqual([
      { number: 1, name: undefined, episodes: [['7', 1, 1]] },
      {
        number: 3,
        name: undefined,
        episodes: [
          ['8', 3, 1],
          ['9', 3, 2],
        ],
      },
    ]);
    // "S03E02" alone leaves no title; missing fields are omitted.
    expect(info?.seasons[1]?.episodes[1]).toEqual({ externalId: '9', season: 3, number: 2 });
    expect(info?.info).toEqual({});
  });

  it('a season given as an object keyed by index', () => {
    const info = parseSeriesInfo({
      episodes: { '2': { '0': { id: 21, episode_num: 1 }, '1': { id: 22, episode_num: 2 } } },
    });
    expect(shape(info)).toEqual([
      {
        number: 2,
        name: undefined,
        episodes: [
          ['21', 2, 1],
          ['22', 2, 2],
        ],
      },
    ]);
  });

  it('seasons metadata without episodes is dropped; odd values never throw', () => {
    expect(parseSeriesInfo({ seasons: [{ season_number: 1 }], episodes: [] })?.seasons).toEqual([]);
    expect(parseSeriesInfo({ seasons: 'x', episodes: 'y', info: 3 })).toEqual({
      info: {},
      seasons: [],
    });
    expect(parseSeriesInfo(null)).toBeUndefined();
    expect(parseSeriesInfo('text')).toBeUndefined();
  });

  it('keeps free text as text (no HTML parsing) and rejects non-http images', () => {
    const info = parseSeriesInfo({
      info: { plot: '<b>x</b>', cover: 'javascript:alert(1)' },
      episodes: { '1': [{ id: 1, title: '<img src=x onerror=alert(1)>' }] },
    });
    expect(info?.info).toEqual({ plot: '<b>x</b>' });
    expect(info?.seasons[0]?.episodes[0]?.title).toBe('<img src=x onerror=alert(1)>');
  });

  it(`stops after ${MAX_EPISODES} episodes`, () => {
    const many = Array.from({ length: MAX_EPISODES + 10 }, (_, i) => ({ id: i + 1, season: 1 }));
    const info = parseSeriesInfo({ episodes: many });
    expect(info?.seasons[0]?.episodes).toHaveLength(MAX_EPISODES);
  });
});

describe('episodeTitle', () => {
  it.each([
    ['S01E01 - Pilot', 'Pilot'],
    ['S1 E2: The Return', 'The Return'],
    ['Show - S02E10 - Finale', 'Finale'],
    ['S01E01', undefined],
    ['Pilot', 'Pilot'],
    ['', undefined],
    [42, '42'],
  ])('%s → %s', (raw, expected) => {
    expect(episodeTitle(raw)).toBe(expected);
  });
});

describe('fetchSeriesInfo', () => {
  it('calls get_series_info with the series id', async () => {
    const call = vi.fn().mockResolvedValue(xtreamFixtures.seriesInfoEpisodesArray);
    const info = await fetchSeriesInfo({ call }, '3002');
    expect(call).toHaveBeenCalledWith('get_series_info', { series_id: '3002' }, undefined);
    expect(info.seasons).toHaveLength(2);
  });

  it('an unusable body gives no seasons', async () => {
    const info = await fetchSeriesInfo({ call: vi.fn().mockResolvedValue('nope') }, '1');
    expect(info).toEqual({ info: {}, seasons: [] });
  });
});
