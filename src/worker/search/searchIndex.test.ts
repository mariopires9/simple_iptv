// @vitest-environment node
// SCH-01: the pure search index — documents, prefix/fuzzy/number matching, grouping, serialization.
import { describe, expect, it } from 'vitest';
import {
  categoryKey,
  isSearchableQuery,
  itemKey,
  normalizeName,
  tokenizeSearchText as tokenize,
  type CatalogItem,
} from '@/core/db';
import {
  buildSearchIndex,
  loadSearchIndex,
  querySearchIndex,
  serializeSearchIndex,
  toSearchDoc,
} from './searchIndex';

const SRC = 'src1';

function channel(id: number, name: string, extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    key: itemKey(SRC, 'live', id),
    sourceId: SRC,
    type: 'live',
    externalId: String(id),
    categoryKey: categoryKey(SRC, 'live', 'news'),
    name,
    nameNorm: normalizeName(name),
    order: id,
    number: id,
    streamPath: `${id}.ts`,
    ...extra,
  } as CatalogItem;
}

function movie(id: number, name: string, extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    key: itemKey(SRC, 'movie', id),
    sourceId: SRC,
    type: 'movie',
    externalId: String(id),
    categoryKey: categoryKey(SRC, 'movie', 'action'),
    name,
    order: id,
    streamPath: `${id}.mp4`,
    ...extra,
  } as CatalogItem;
}

function series(id: number, name: string): CatalogItem {
  return {
    key: itemKey(SRC, 'series', id),
    sourceId: SRC,
    type: 'series',
    externalId: String(id),
    name,
    order: id,
  };
}

const CATALOG: CatalogItem[] = [
  channel(1, 'PT | RTP 1 HD'),
  channel(2, 'Sport TV 1'),
  channel(3, 'Sport TV 2'),
  channel(101, 'Notícias Exemplo'),
  channel(7, 'Documentary World'),
  movie(10, 'The Synthetic Movie (2024)'),
  movie(11, 'Sporting Legends'),
  movie(12, 'Comédia Sintética'),
  series(20, 'Example Drama'),
  series(21, 'Sport Stories'),
];

const index = buildSearchIndex(CATALOG);
const names = (q: string) => {
  const r = querySearchIndex(index, SRC, q);
  return {
    live: r.live.hits.map((h) => h.externalId),
    movie: r.movie.hits.map((h) => h.externalId),
    series: r.series.hits.map((h) => h.externalId),
  };
};

describe('tokenize', () => {
  it('normalizes case and diacritics and splits on anything but letters and digits', () => {
    expect(tokenize('|PT| Notícias — São João (HD)')).toEqual([
      'pt',
      'noticias',
      'sao',
      'joao',
      'hd',
    ]);
    // Decomposed input (NFD) does not split words on the combining marks.
    expect(tokenize('Notícias')).toEqual(['noticias']);
  });

  it('needs at least 2 letters or digits to search', () => {
    expect(isSearchableQuery('a')).toBe(false);
    expect(isSearchableQuery(' a ! ')).toBe(false);
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery('a b')).toBe(true);
  });
});

describe('documents', () => {
  it('index only the name, the channel number and the category id', () => {
    expect(
      toSearchDoc(channel(5, 'Five', { logo: 'https://x/l.png' } as Partial<CatalogItem>)),
    ).toEqual({
      id: 'l:5',
      name: 'Five',
      num: '5',
      c: 'news',
    });
    expect(toSearchDoc(movie(9, 'Nine'))).toEqual({ id: 'm:9', name: 'Nine', c: 'action' });
    expect(toSearchDoc(series(8, 'Eight'))).toEqual({ id: 's:8', name: 'Eight' });
    expect(toSearchDoc(series(8, ' -- '))).toBeUndefined();
  });

  it('keeps stream URLs, logos and credentials out of the serialized index', () => {
    const secret = 'jdoe/testpass';
    const data = serializeSearchIndex(
      buildSearchIndex([
        channel(1, 'Example News', {
          streamUrl: `http://panel.example.test/live/${secret}/1.ts`,
          logo: `http://panel.example.test/logo?password=testpass`,
        } as Partial<CatalogItem>),
        movie(2, 'Example Movie', { streamUrl: `http://panel.example.test/movie/${secret}/2.mp4` }),
      ]),
    );
    expect(data).not.toContain('testpass');
    expect(data).not.toContain('jdoe');
    expect(data).not.toContain('http');
  });
});

describe('querySearchIndex', () => {
  it('matches word prefixes, every term required', () => {
    expect(names('spo')).toEqual({ live: ['2', '3'], movie: ['11'], series: ['21'] });
    expect(names('sport legends')).toEqual({ live: [], movie: ['11'], series: [] });
    // "2" matches the name of channel 3 and the number of channel 2; the name match ranks first.
    expect(names('sport tv 2').live).toEqual(['3', '2']);
    expect(names('synth mov')).toEqual({ live: [], movie: ['10'], series: [] });
  });

  it('ignores case and diacritics', () => {
    expect(names('NOTICIAS').live).toEqual(['101']);
    expect(names('comedia').movie).toEqual(['12']);
    expect(names('comédia sintética').movie).toEqual(['12']);
  });

  it('finds an item with one typo in a term of 5 or more letters (fuzzy 0.2)', () => {
    expect(names('documentry').live).toEqual(['7']); // missing letter
    expect(names('exmple').series).toEqual(['20']); // missing letter, 6 letters
    expect(names('dramo').series).toEqual(['20']); // substitution, 5 letters
  });

  it('does not apply fuzzy matching to terms shorter than 5 letters', () => {
    expect(names('drma')).toEqual({ live: [], movie: [], series: [] });
  });

  it('matches channels by number', () => {
    expect(names('101').live).toEqual(['101']);
    expect(querySearchIndex(index, SRC, '7').live.hits).toEqual([]); // 1 digit: below the minimum
    expect(names('rtp 1').live).toEqual(['1']);
  });

  it('returns nothing for a query below 2 letters/digits', () => {
    expect(names('s')).toEqual({ live: [], movie: [], series: [] });
  });

  it('rebuilds the item and category keys of the source', () => {
    const [hit] = querySearchIndex(index, SRC, 'rtp').live.hits;
    expect(hit).toEqual({
      key: itemKey(SRC, 'live', 1),
      type: 'live',
      externalId: '1',
      categoryKey: categoryKey(SRC, 'live', 'news'),
    });
  });

  it('limits the hits per type, counts every match and filters types', () => {
    const many = buildSearchIndex(Array.from({ length: 50 }, (_, i) => movie(i + 1, `Alpha ${i}`)));
    const r = querySearchIndex(many, SRC, 'alpha', { limit: 20 });
    expect(r.movie.total).toBe(50);
    expect(r.movie.hits).toHaveLength(20);
    const onlyLive = querySearchIndex(index, SRC, 'sport', { types: ['live'] });
    expect(onlyLive.live.total).toBe(2);
    expect(onlyLive.movie).toEqual({ total: 0, hits: [] });
  });

  it('skips items with repeated ids instead of failing', () => {
    expect(() => buildSearchIndex([movie(1, 'Same'), movie(1, 'Same again')])).not.toThrow();
  });
});

describe('serialization', () => {
  it('a loaded index answers like the built one', () => {
    const loaded = loadSearchIndex(serializeSearchIndex(index));
    for (const q of ['spo', 'documentry', '101', 'comedia', 'example drama']) {
      expect(querySearchIndex(loaded, SRC, q)).toEqual(querySearchIndex(index, SRC, q));
    }
  });

  it('throws on corrupt data', () => {
    expect(() => loadSearchIndex('{not json')).toThrow();
  });
});

describe('protected content (UX-07)', () => {
  const items = [
    channel(1, 'Sport One'),
    channel(2, 'Sport Two', { drm: true }),
    movie(3, 'Sport Movie', { container: 'dash' }),
    movie(4, 'Sport Story'),
  ];

  it('marks protected documents with p = 1, and nothing else about the stream', () => {
    expect(toSearchDoc(channel(2, 'Sport Two', { drm: true }))).toMatchObject({ p: 1 });
    expect(toSearchDoc(channel(1, 'Sport One'))?.p).toBeUndefined();
  });

  it('hideProtected leaves protected items out of hits and totals (also after a reload)', () => {
    const index = loadSearchIndex(serializeSearchIndex(buildSearchIndex(items)));
    const all = querySearchIndex(index, SRC, 'sport');
    expect(all.live.total).toBe(2);
    expect(all.movie.total).toBe(2);
    const shown = querySearchIndex(index, SRC, 'sport', { hideProtected: true, limit: 1 });
    expect(shown.live).toEqual({ total: 1, hits: [expect.objectContaining({ externalId: '1' })] });
    expect(shown.movie).toEqual({ total: 1, hits: [expect.objectContaining({ externalId: '4' })] });
  });
});
