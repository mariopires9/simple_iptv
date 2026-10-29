// SRC-07: tolerant mapping of Xtream catalogue entries (ADR-013).
import { describe, expect, it } from 'vitest';
import {
  mapCategories,
  mapLiveStreams,
  mapSeries,
  mapVodStreams,
  toExternalId,
  toYear,
  UNCATEGORIZED_CATEGORY_ID,
  withUncategorized,
} from './catalog';
import { UNCATEGORIZED_CATEGORY_ID as M3U_UNCATEGORIZED } from '@/providers/m3u';
import { toInt, toNumber } from './schemas';

describe('withUncategorized (VOD-01 review)', () => {
  const cats = [
    { externalId: '1', name: 'News' },
    { externalId: '2', name: 'Sports' },
  ];

  it('uses the same synthetic id as M3U lists', () => {
    expect(UNCATEGORIZED_CATEGORY_ID).toBe(M3U_UNCATEGORIZED);
  });

  it('moves items with a missing or unknown category to a synthetic one, appended last', () => {
    const live = mapLiveStreams([
      { stream_id: 1, name: 'A', category_id: '1' },
      { stream_id: 2, name: 'B' },
      { stream_id: 3, name: 'C', category_id: '99' },
    ]).items;
    const movies = mapVodStreams([{ stream_id: 4, name: 'M', category_id: 'gone' }]).items;
    const series = mapSeries([{ series_id: 5, name: 'S' }]).items;
    const lists: { categoryExternalId?: string }[][] = [live, movies, series];
    for (const items of lists) {
      const result = withUncategorized(cats, items);
      expect(result.categories.at(-1)).toEqual({ externalId: 'uncategorized', name: '' });
      expect(result.categories.slice(0, 2)).toEqual(cats);
      expect(result.items.every((i) => i.categoryExternalId !== undefined)).toBe(true);
    }
    expect(withUncategorized(cats, live).items.map((i) => i.categoryExternalId)).toEqual([
      '1',
      'uncategorized',
      'uncategorized',
    ]);
  });

  it('adds nothing when every item has a known category', () => {
    const items = mapLiveStreams([{ stream_id: 1, name: 'A', category_id: '2' }]).items;
    const result = withUncategorized(cats, items);
    expect(result.categories).toEqual(cats);
    expect(result.items).toEqual(items);
  });
});

describe('coercion helpers', () => {
  it.each([
    [1001, '1001'],
    ['1001', '1001'],
    [' 0042 ', '42'],
    [0, '0'],
    [-1, undefined],
    ['abc', undefined],
    ['1e3', undefined],
    [1.5, undefined],
    [null, undefined],
    ['', undefined],
  ])('toExternalId(%j) → %j', (input, expected) => {
    expect(toExternalId(input)).toBe(expected);
  });

  it.each([
    ['7.1', 7.1],
    [8, 8],
    [' 6 ', 6],
    ['', undefined],
    [null, undefined],
    ['n/a', undefined],
    [Number.NaN, undefined],
  ])('toNumber(%j) → %j', (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });

  it('one parser: toInt is toNumber with truncation', () => {
    expect(toNumber('12.9', true)).toBe(12);
    expect(toInt('12.9')).toBe(12);
    expect(toNumber('12.9')).toBe(12.9);
    expect(toNumber(-3.7, true)).toBe(-3);
    expect(toNumber(Infinity, true)).toBeUndefined();
  });

  it.each([
    ['2024', 2024],
    [2024, 2024],
    ['2024-03-01', 2024],
    ['1700', undefined],
    ['', undefined],
    ['20245', undefined],
    [null, undefined],
  ])('toYear(%j) → %j', (input, expected) => {
    expect(toYear(input)).toBe(expected);
  });
});

describe('mappers', () => {
  it('categories: trims names, keeps order, skips entries without id or name', () => {
    expect(
      mapCategories([
        { category_id: 2, category_name: ' B ' },
        { category_id: '1', category_name: 'A', parent_id: null, extra: {} },
        { category_id: '', category_name: 'x' },
        { category_id: '3', category_name: null },
        'junk',
      ]),
    ).toEqual({
      items: [
        { externalId: '2', name: 'B' },
        { externalId: '1', name: 'A' },
      ],
      skipped: 3,
    });
  });

  it('live: id-only stream path, optional fields dropped when unusable', () => {
    const { items } = mapLiveStreams([
      {
        stream_id: '7',
        name: ' Seven ',
        num: '',
        stream_icon: 'data:image/png;base64,AAAA',
        epg_channel_id: '',
        category_id: null,
        tv_archive: '1',
        tv_archive_duration: '',
      },
    ]);
    expect(items).toEqual([{ externalId: '7', name: 'Seven', streamPath: '7', catchup: {} }]);
  });

  it('movies: extension lowercased into streamPath; odd extensions dropped', () => {
    const { items } = mapVodStreams([
      { stream_id: 1, name: 'A', container_extension: 'MKV', rating: '0', added: '1735689600' },
      { stream_id: 2, name: 'B', container_extension: '../x', year: '2020' },
    ]);
    expect(items[0]).toEqual({
      externalId: '1',
      name: 'A',
      streamPath: '1.mkv',
      ext: 'mkv',
      addedAt: 1_735_689_600_000,
    });
    expect(items[1]).toEqual({ externalId: '2', name: 'B', streamPath: '2', year: 2020 });
  });

  it('series: year from releaseDate / release_date, rating 0 is "not rated"', () => {
    const { items } = mapSeries([
      { series_id: 5, name: 'S', releaseDate: '2019-01-02', rating: 0, cover: '' },
      { series_id: 6, name: 'T', release_date: '2001', rating: '7.25' },
    ]);
    expect(items).toEqual([
      { externalId: '5', name: 'S', year: 2019 },
      { externalId: '6', name: 'T', year: 2001, rating: 7.3 },
    ]);
  });

  it('image URLs must be http(s) without userinfo and pass the storable-URL check', () => {
    const { items } = mapVodStreams(
      [
        { stream_id: 1, name: 'A', stream_icon: 'https://img.example.test/a.jpg' },
        { stream_id: 2, name: 'B', stream_icon: 'https://img.example.test/secret.jpg' },
        { stream_id: 3, name: 'C', stream_icon: 'https://u:p@img.example.test/c.jpg' },
      ],
      { isStorableUrl: (href) => !href.includes('secret') },
    );
    expect(items.map((i) => i.poster)).toEqual([
      'https://img.example.test/a.jpg',
      undefined,
      undefined,
    ]);
  });
});
