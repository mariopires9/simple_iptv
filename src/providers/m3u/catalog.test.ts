// @vitest-environment node
// SRC-04: entries → catalogue rows — stable keys across re-imports, duplicates, the synthetic
// "Uncategorized" category (AC9), flags stored on the rows (AC8) and the storable-URL filter.
import { describe, expect, it } from 'vitest';
import {
  M3uCatalogBuilder,
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_NAME,
  entryBaseId,
  groupCategoryId,
  hash64,
  showSeriesId,
} from './catalog';
import { parseM3uText } from './parser';

function build(text: string, isStorableUrl?: (href: string) => boolean) {
  const builder = new M3uCatalogBuilder(isStorableUrl ? { isStorableUrl } : {});
  for (const entry of parseM3uText(text).entries) builder.add(entry);
  return builder.build();
}

const LIST = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="a.pt" tvg-chno="5" tvg-logo="https://img.example.test/a.png" group-title="News",A',
  'https://s.example.test/live/a.m3u8',
  '#EXTINF:-1,No Group',
  'https://s.example.test/live/b.ts',
  '#EXTINF:-1 group-title="Sports",A',
  'https://s.example.test/live/a.m3u8',
  '#EXTINF:-1 tvg-logo="https://img.example.test/m.jpg" group-title="Films",Movie',
  'https://s.example.test/movie/1.mkv',
  '#EXTINF:-1 group-title="Shows",Episode',
  'https://s.example.test/series/1.mp4',
  '#EXTINF:-1 catchup="default" catchup-days="3" catchup-source="https://s.example.test/ts/{utc}" group-title="News",C',
  'https://s.example.test/live/c.m3u8',
  '#EXTINF:-1 radio="true",Radio',
  '#KODIPROP:inputstream.adaptive.license_type=x',
  '#EXTVLCOPT:http-referrer=https://r.example.test/',
  'https://s.example.test/live/r.mpd',
].join('\n');

describe('hash64', () => {
  it('is deterministic, 16 hex chars, and sensitive to every character', () => {
    expect(hash64('abc')).toBe(hash64('abc'));
    expect(hash64('abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64('abc')).not.toBe(hash64('abd'));
    expect(hash64('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('has no collisions over 200,000 similar inputs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200_000; i++)
      seen.add(hash64(`http://h.example.test/live/${i}.ts\nCh ${i}`));
    expect(seen.size).toBe(200_000);
  });
});

describe('M3uCatalogBuilder', () => {
  it('keys are stable across re-imports (favourites survive)', () => {
    const first = build(LIST);
    const second = build(LIST);
    expect(second).toEqual(first);
    expect(first.live.items[0]?.externalId).toBe(
      entryBaseId('https://s.example.test/live/a.m3u8', 'A'),
    );
  });

  it('a key does not depend on the entry position', () => {
    const reordered = LIST.split('\n');
    // Move "No Group" to the end.
    const moved = reordered.splice(3, 2);
    const a = build(LIST).live.items.find((i) => i.name === 'No Group');
    const b = build([...reordered, ...moved].join('\n')).live.items.find(
      (i) => i.name === 'No Group',
    );
    expect(b?.externalId).toBe(a?.externalId);
  });

  it('exact duplicates (same URL and name) are all kept with numbered ids', () => {
    const ids = build(LIST)
      .live.items.filter((i) => i.name === 'A')
      .map((i) => i.externalId);
    const base = entryBaseId('https://s.example.test/live/a.m3u8', 'A');
    expect(ids).toEqual([base, `${base}-2`]);
  });

  it('entries without a group go to the synthetic Uncategorized category (AC9)', () => {
    const { live } = build(LIST);
    expect(live.categories.map((c) => c.name)).toEqual([
      'News',
      UNCATEGORIZED_CATEGORY_NAME,
      'Sports',
    ]);
    expect(live.categories[1]?.externalId).toBe(UNCATEGORIZED_CATEGORY_ID);
    // Stored nameless (language-neutral); the UI localises it by id.
    expect(UNCATEGORIZED_CATEGORY_NAME).toBe('');
    expect(live.categories[0]?.externalId).toBe(groupCategoryId('News'));
    // Every item has a category.
    expect(live.items.every((i) => i.categoryExternalId !== undefined)).toBe(true);
    expect(live.items.find((i) => i.name === 'Radio')?.categoryExternalId).toBe(
      UNCATEGORIZED_CATEGORY_ID,
    );
  });

  it('categories are per type, in order of first appearance', () => {
    const catalog = build(LIST);
    expect(catalog.movie.categories.map((c) => c.name)).toEqual(['Films']);
    expect(catalog.series.categories.map((c) => c.name)).toEqual(['Shows']);
  });

  it('maps live fields, the full stream URL and only the flags that are set', () => {
    const { live } = build(LIST);
    const a = live.items[0];
    expect(a).toEqual({
      externalId: entryBaseId('https://s.example.test/live/a.m3u8', 'A'),
      name: 'A',
      streamPath: '', // the URL is stored once, in streamUrl
      streamUrl: 'https://s.example.test/live/a.m3u8',
      container: 'hls',
      categoryExternalId: groupCategoryId('News'),
      logo: 'https://img.example.test/a.png',
      number: 5,
      epgId: 'a.pt',
    });
    expect(live.items.find((i) => i.name === 'C')?.catchup).toEqual({
      days: 3,
      source: 'https://s.example.test/ts/{utc}',
    });
    expect(live.items.find((i) => i.name === 'Radio')).toMatchObject({
      drm: true,
      container: 'dash',
      audioOnly: true,
      requiredHeaders: ['referer'],
    });
  });

  it('maps movies and series (episodes) with their URL', () => {
    const { movie, series } = build(LIST);
    expect(movie.items[0]).toMatchObject({
      name: 'Movie',
      ext: 'mkv',
      poster: 'https://img.example.test/m.jpg',
      streamUrl: 'https://s.example.test/movie/1.mkv',
      streamPath: '',
    });
    expect(series.items[0]).toMatchObject({
      name: 'Episode',
      streamUrl: 'https://s.example.test/series/1.mp4',
    });
  });

  it('drops images and catch-up templates rejected by isStorableUrl', () => {
    const { live } = build(LIST, (href) => !href.includes('img.') && !href.includes('/ts/'));
    expect(live.items[0]?.logo).toBeUndefined();
    expect(live.items.find((i) => i.name === 'C')?.catchup).toEqual({ days: 3 });
  });
});

describe('M3uCatalogBuilder — grouped series (VOD-04 AC3)', () => {
  const SHOWS = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="https://img.example.test/a1.jpg" group-title="Séries",Ação Total S01E02',
    'https://s.example.test/v/a-s1e2.mp4',
    '#EXTINF:-1 group-title="Séries",Ação Total S01E01 - Piloto',
    'https://s.example.test/v/a-s1e1.mp4',
    '#EXTINF:-1 group-title="News",Live Channel',
    'https://s.example.test/live/n.m3u8',
    '#EXTINF:3600 group-title="Séries",ACAO TOTAL - S02E01',
    'https://s.example.test/v/a-s2e1.mkv',
    '#EXTINF:-1 group-title="Séries Kids",Ação Total S01E01',
    'https://s.example.test/v/kids-s1e1.mp4',
    '#EXTINF:-1 group-title="Séries",Other Show 1x03',
    'https://s.example.test/v/o-103.mp4',
    '#EXTINF:-1 group-title="Séries",Single Entry Without Marker',
    'https://s.example.test/v/single.mp4',
  ].join('\n');

  it('one series row per show and group, at its first episode, with seasons in order', () => {
    const { series, seriesDetails, live } = build(SHOWS);
    expect(live.items.map((i) => i.name)).toEqual(['Live Channel']);
    expect(series.items.map((i) => i.name)).toEqual([
      'Ação Total',
      'Ação Total',
      'Other Show',
      'Single Entry Without Marker',
    ]);
    const [main, kids] = series.items;
    expect(main?.externalId).toBe(showSeriesId('Ação Total', 'Séries'));
    // Case, accents and punctuation do not split a show; another group does.
    expect(showSeriesId('ACAO TOTAL', 'Séries')).toBe(main?.externalId);
    expect(kids?.externalId).toBe(showSeriesId('Ação Total', 'Séries Kids'));
    expect(kids?.externalId).not.toBe(main?.externalId);
    expect(main).toMatchObject({ seasonCount: 2, cover: 'https://img.example.test/a1.jpg' });
    expect(main?.streamUrl).toBeUndefined();
    // A series entry without a marker stays one row with its own URL.
    expect(series.items[3]).toMatchObject({ streamUrl: 'https://s.example.test/v/single.mp4' });

    const details = seriesDetails.find((d) => d.seriesExternalId === main?.externalId);
    expect(details?.seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(details?.seasons[0]?.episodes.map((e) => [e.number, e.title])).toEqual([
      [1, 'Piloto'],
      [2, 'Ação Total S01E02'],
    ]);
    expect(details?.seasons[1]?.episodes[0]).toEqual({
      externalId: entryBaseId('https://s.example.test/v/a-s2e1.mkv', 'ACAO TOTAL - S02E01'),
      season: 2,
      number: 1,
      title: 'ACAO TOTAL - S02E01',
      streamPath: '',
      streamUrl: 'https://s.example.test/v/a-s2e1.mkv',
      container: 'mkv',
      ext: 'mkv',
      durationSec: 3600,
    });
    expect(seriesDetails).toHaveLength(3);
  });

  it('episode ids depend on the entry, not on its position (resume survives re-imports)', () => {
    const lines = SHOWS.split('\n');
    const reordered = [lines[0]!, ...lines.slice(7, 9), ...lines.slice(1, 7), ...lines.slice(9)];
    const ids = (text: string) =>
      build(text)
        .seriesDetails.flatMap((d) => d.seasons.flatMap((s) => s.episodes.map((e) => e.externalId)))
        .sort();
    expect(ids(reordered.join('\n'))).toEqual(ids(SHOWS));
    expect(
      build(reordered.join('\n'))
        .series.items.map((i) => i.externalId)
        .sort(),
    ).toEqual(
      build(SHOWS)
        .series.items.map((i) => i.externalId)
        .sort(),
    );
  });

  it('the cover comes from the first episode that has an image; rejected images are dropped', () => {
    const { series, seriesDetails } = build(SHOWS, (href) => !href.includes('img.'));
    expect(series.items[0]?.cover).toBeUndefined();
    expect(seriesDetails[0]?.seasons[0]?.episodes.every((e) => e.image === undefined)).toBe(true);
  });
});
