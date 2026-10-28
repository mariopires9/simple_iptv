// SRC-07: tolerant mapping of Xtream catalogue entries (ADR-013).
import { describe, expect, it } from 'vitest';
import {
  mapCategories,
  mapLiveStreams,
  mapSeries,
  mapVodStreams,
  toExternalId,
  toYear,
} from './catalog';
import { toInt, toNumber } from './schemas';

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
