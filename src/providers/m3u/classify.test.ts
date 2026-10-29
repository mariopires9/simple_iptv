// VOD-04: live / movie / series classification of M3U entries — an examples table (≥ 40 cases)
// run through the real parser (attributes, URL, container), plus the rule helpers. All entries
// are synthetic; "real-world shapes" mimic the public Portuguese list analysed in S-00 (dated
// talk-show episodes with `media="true"`, `S14E08 25-10-2026` names) without copying it.
import { describe, expect, it } from 'vitest';
import type { ContentType } from '@/core/db';
import {
  DEFAULT_M3U_RULES,
  M3uClassifier,
  classifyEntry,
  classifyGroup,
  cleanShowName,
  episodeMarker,
  showGroupIdentity,
  showIdentity,
  strongEpisodeMarker,
  type M3uClassificationRules,
} from './classify';
import { parseM3uText } from './parser';

interface Case {
  /** Attributes of the `#EXTINF` line (without the duration). */
  attrs?: string;
  name: string;
  url: string;
  type: ContentType;
  /** Expected grouping for series entries with a marker: [show, season, episode]. */
  episode?: [string, number, number];
  /** Extra lines before the URL (e.g. `#EXTGRP`). */
  extra?: string[];
}

const H = 'https://vod.example.test';

const CASES: Record<string, Case> = {
  // --- 1. URL path (Xtream pattern, AC1) ---
  'Xtream /movie/ path': { url: `${H}/movie/u/p/1.mp4`, name: 'Some Film (2020)', type: 'movie' },
  'Xtream /series/ path with "S01 E02"': {
    url: `${H}/series/u/p/2.mkv`,
    name: 'Example Drama S01 E02',
    type: 'series',
    episode: ['Example Drama', 1, 2],
  },
  'Xtream /series/ path without a marker (one entry, ungrouped)': {
    url: `${H}/series/u/p/3.mp4`,
    name: 'Some Show',
    type: 'series',
  },
  'Xtream /live/ path wins over a "Movies" group (24/7 channel)': {
    attrs: 'group-title="Movies"',
    url: `${H}/live/u/p/4.ts`,
    name: 'Action Movies 24/7',
    type: 'live',
  },
  'Xtream /movie/ path wins over an episode marker': {
    url: `${H}/movie/u/p/5.mp4`,
    name: 'Pilot S01E01 (compilation)',
    type: 'movie',
  },
  'Xtream /live/ path with a "1x2" score in the name': {
    attrs: 'group-title="Desporto"',
    url: `${H}/live/u/p/6.m3u8`,
    name: 'Benfica 1x2 Porto',
    type: 'live',
  },

  // --- 2. Audio-only ---
  'radio="true" stays live': {
    attrs: 'radio="true" group-title="Rádios"',
    url: `${H}/radio/a.m3u8`,
    name: 'Rádio Exemplo',
    type: 'live',
  },
  '.mp3 in a VOD group stays live (audio)': {
    attrs: 'group-title="VOD"',
    url: `${H}/files/episode.mp3`,
    name: 'Podcast Exemplo',
    type: 'live',
  },

  // --- 3. Group title (AC2) ---
  '"VOD" group, HLS': {
    attrs: 'group-title="VOD"',
    url: `${H}/hls/a/index.m3u8`,
    name: 'A Film',
    type: 'movie',
  },
  '"Movies | Action"': {
    attrs: 'group-title="Movies | Action"',
    url: `${H}/hls/b.m3u8`,
    name: 'Action Film',
    type: 'movie',
  },
  '"Filmes - Ação" (Portuguese, diacritics)': {
    attrs: 'group-title="Filmes - Ação"',
    url: `${H}/hls/c.m3u8`,
    name: 'O Filme',
    type: 'movie',
  },
  '"PT | FILMES" (country code prefix)': {
    attrs: 'group-title="PT | FILMES"',
    url: `${H}/hls/d.m3u8`,
    name: 'Filme Português',
    type: 'movie',
  },
  '"|EN| Movies 4K"': {
    attrs: 'group-title="|EN| Movies 4K"',
    url: `${H}/hls/e.m3u8`,
    name: 'English Film 4K',
    type: 'movie',
  },
  '"4K Movies" (quality tag first)': {
    attrs: 'group-title="4K Movies"',
    url: `${H}/hls/f.m3u8`,
    name: 'UHD Film',
    type: 'movie',
  },
  '"Películas" (Spanish)': {
    attrs: 'group-title="Películas"',
    url: `${H}/hls/g.m3u8`,
    name: 'La Película',
    type: 'movie',
  },
  '"Séries | Drama" with S01E01': {
    attrs: 'group-title="Séries | Drama"',
    url: `${H}/hls/h.m3u8`,
    name: 'Ação Total S01E01',
    type: 'series',
    episode: ['Ação Total', 1, 1],
  },
  '"SERIES" without a marker (one entry)': {
    attrs: 'group-title="SERIES"',
    url: `${H}/hls/i.m3u8`,
    name: 'Some Show',
    type: 'series',
  },
  '"Series" group allows the weak "1x02"': {
    attrs: 'group-title="Series"',
    url: `${H}/hls/j.m3u8`,
    name: 'Show Name 1x02',
    type: 'series',
    episode: ['Show Name', 1, 2],
  },
  '"TV Shows" (two-word keyword)': {
    attrs: 'group-title="TV Shows"',
    url: `${H}/hls/k.m3u8`,
    name: 'Late Talk S02E03',
    type: 'series',
    episode: ['Late Talk', 2, 3],
  },
  '"VOD | Series" with a marker': {
    attrs: 'group-title="VOD | Series"',
    url: `${H}/hls/l.m3u8`,
    name: 'Mystery S03E05',
    type: 'series',
    episode: ['Mystery', 3, 5],
  },
  '"Filmes" with the weak "2x10" stays a movie': {
    attrs: 'group-title="Filmes"',
    url: `${H}/hls/m.m3u8`,
    name: 'Rocky 2x10 Edição',
    type: 'movie',
  },
  '"Filmes" with a strong marker becomes a series': {
    attrs: 'group-title="Filmes"',
    url: `${H}/hls/n.m3u8`,
    name: 'Mini Série S01E02',
    type: 'series',
    episode: ['Mini Série', 1, 2],
  },
  '#EXTGRP "Movies" without group-title': {
    extra: ['#EXTGRP:Movies'],
    url: `${H}/hls/o.m3u8`,
    name: 'Grouped Film',
    type: 'movie',
  },

  // --- 3b. Live words in the group win (safe default) ---
  '"Filmes 24/7" channels': {
    attrs: 'group-title="Filmes 24/7"',
    url: `${H}/hls/p.m3u8`,
    name: 'Cinema Clássico',
    type: 'live',
  },
  '"Canais de Filmes"': {
    attrs: 'group-title="Canais de Filmes"',
    url: `${H}/hls/q.m3u8`,
    name: 'TVCine Exemplo',
    type: 'live',
  },
  '"Ao Vivo" leading the group ignores an episode marker': {
    attrs: 'group-title="Ao Vivo | Séries"',
    url: `${H}/hls/s.m3u8`,
    name: 'Show S01E02',
    type: 'live',
  },
  '"Desporto Ao Vivo" (live word after a non-VOD word)': {
    attrs: 'group-title="Desporto Ao Vivo"',
    url: `${H}/hls/s2.mp4`,
    name: 'Jogo Exemplo',
    type: 'live',
  },
  '"Séries 24h" (looping channel, 24h wins anywhere)': {
    attrs: 'group-title="Séries 24h"',
    url: `${H}/hls/s3.m3u8`,
    name: 'Show S01E02',
    type: 'live',
  },

  // --- 3b'. A leading VOD keyword wins over a later live word (review #2) ---
  '"Filmes Canal Hollywood"': {
    attrs: 'group-title="Filmes Canal Hollywood"',
    url: `${H}/hls/k1.m3u8`,
    name: 'Um Filme',
    type: 'movie',
  },
  '"Séries Live Action" with a marker': {
    attrs: 'group-title="Séries Live Action"',
    url: `${H}/hls/k2.m3u8`,
    name: 'Heroes S01E03',
    type: 'series',
    episode: ['Heroes', 1, 3],
  },
  '"Movies Channel"': {
    attrs: 'group-title="Movies Channel"',
    url: `${H}/hls/k3.m3u8`,
    name: 'Movie Night',
    type: 'movie',
  },
  '"VOD | Live Concerts"': {
    attrs: 'group-title="VOD | Live Concerts"',
    url: `${H}/hls/k4.m3u8`,
    name: 'Concert 2024',
    type: 'movie',
  },
  '"Movies Live"': {
    attrs: 'group-title="Movies Live"',
    url: `${H}/hls/r.mp4`,
    name: 'Live Movie Event',
    type: 'movie',
  },
  '"S01E01 - Pilot" in a generic "Séries" group: ungrouped (review #3)': {
    attrs: 'group-title="Séries"',
    url: `${H}/hls/k5.m3u8`,
    name: 'S01E01 - Pilot',
    type: 'series',
  },
  '"S01E01" in a generic "VOD" group: ungrouped': {
    attrs: 'group-title="VOD"',
    url: `${H}/hls/k6.mp4`,
    name: 'S01E01 Winter is coming',
    type: 'series',
  },
  '"S01E01" without any group: ungrouped': {
    url: `${H}/files/k7.mp4`,
    name: 'S01E01 - Pilot',
    type: 'series',
  },
  '"Temporada 2 e 3" is not S2E3 (review #7)': {
    url: `${H}/hls/k8.m3u8`,
    name: 'Resumo Temporada 2 e 3',
    type: 'live',
  },
  '"Season 1 E2" (bare E followed by digits)': {
    url: `${H}/hls/k9.m3u8`,
    name: 'Bare Season 1 E2',
    type: 'series',
    episode: ['Bare', 1, 2],
  },
  'decomposed (NFD) "Temporada 1 Episódio 4"': {
    url: `${H}/hls/k10.m3u8`,
    name: 'Série NFD Temporada 1 Episódio 4'.normalize('NFD'),
    type: 'series',
    episode: ['Série NFD', 1, 4],
  },

  // --- 3c. Not a prefix / ambiguous group → other rules or live ---
  '"Cinema" group (often live movie channels)': {
    attrs: 'group-title="Cinema"',
    url: `${H}/hls/t.m3u8`,
    name: 'Cinema Um HD',
    type: 'live',
  },
  '"Netflix Séries" without other signals': {
    attrs: 'group-title="Netflix Séries"',
    url: `${H}/hls/u.m3u8`,
    name: 'Some Show',
    type: 'live',
  },
  '"Serie A" (football league)': {
    attrs: 'group-title="Serie A"',
    url: `${H}/hls/v.m3u8`,
    name: 'Inter x Milan',
    type: 'live',
  },
  '"World Series" (baseball)': {
    attrs: 'group-title="World Series"',
    url: `${H}/hls/w.m3u8`,
    name: 'Game 7',
    type: 'live',
  },
  'channel name containing "Series"': {
    attrs: 'group-title="Entretenimento"',
    url: `${H}/hls/x.m3u8`,
    name: 'AXN Series HD',
    type: 'live',
  },
  'channel name containing "Movies"': {
    attrs: 'group-title="TV"',
    url: `${H}/hls/y.m3u8`,
    name: 'Hollywood Movies FHD',
    type: 'live',
  },

  // --- 4. media="true" (real-world shape from S-00) ---
  'media="true" dated talk show (no marker) → movie': {
    attrs: 'media="true" group-title="Programa Semanal"',
    url: `${H}/hls/z1.m3u8`,
    name: 'Programa Semanal - 22/10/2026',
    type: 'movie',
  },
  'media="true" "S14E08 25-10-2026"': {
    attrs: 'media="true" group-title="ABCDEF"',
    url: `${H}/hls/z2.m3u8`,
    name: 'ABCDEF S14E08 25-10-2026',
    type: 'series',
    episode: ['ABCDEF', 14, 8],
  },
  'media="true" "Show - S01E02"': {
    attrs: 'media="true" group-title="Cem Episódios"',
    url: `${H}/hls/z3.m3u8`,
    name: 'Cem Episódios - S01E02',
    type: 'series',
    episode: ['Cem Episódios', 1, 2],
  },

  // --- 5. VOD extension (AC2) ---
  '.mp4 without a group': { url: `${H}/files/film.mp4`, name: 'Plain Film', type: 'movie' },
  '.mkv with a marker': {
    url: `${H}/files/show-s02e10.mkv`,
    name: 'Show S02E10',
    type: 'series',
    episode: ['Show', 2, 10],
  },
  '.avi': { url: `${H}/files/old.avi`, name: 'Old Film', type: 'movie' },
  '.MP4 upper-case extension': { url: `${H}/files/FILM.MP4`, name: 'Loud Film', type: 'movie' },
  '.mp4 with the weak "1x05"': {
    url: `${H}/files/show-105.mp4`,
    name: 'Show 1x05',
    type: 'series',
    episode: ['Show', 1, 5],
  },
  '.ts is not a VOD extension': { url: `${H}/stream/1.ts`, name: 'Channel One', type: 'live' },
  '.mpd (DASH) stays live': { url: `${H}/dash/manifest.mpd`, name: 'Dash Channel', type: 'live' },
  'HLS without any signal': { url: `${H}/hls/live.m3u8`, name: 'Canal Exemplo', type: 'live' },

  // --- 6. Strong markers on their own (AC3) ---
  '"S01E02" alone on HLS': {
    url: `${H}/hls/m1.m3u8`,
    name: 'Lone Show S01E02',
    type: 'series',
    episode: ['Lone Show', 1, 2],
  },
  'lower-case "s01e02"': {
    url: `${H}/hls/m2.m3u8`,
    name: 'lower show s01e02',
    type: 'series',
    episode: ['lower show', 1, 2],
  },
  '"S1 E2" with a space': {
    url: `${H}/hls/m3.m3u8`,
    name: 'Spaced S1 E2',
    type: 'series',
    episode: ['Spaced', 1, 2],
  },
  '"S01.E02" and "S01-E03"': {
    url: `${H}/hls/m4.m3u8`,
    name: 'Dotted S01.E02',
    type: 'series',
    episode: ['Dotted', 1, 2],
  },
  '"S2 Ep 7"': {
    url: `${H}/hls/m5.m3u8`,
    name: 'With Ep S2 Ep 7',
    type: 'series',
    episode: ['With Ep', 2, 7],
  },
  'Portuguese "T01E02"': {
    url: `${H}/hls/m6.m3u8`,
    name: 'Novela Exemplo T01E02',
    type: 'series',
    episode: ['Novela Exemplo', 1, 2],
  },
  '"Temporada 2 Episódio 5"': {
    url: `${H}/hls/m7.m3u8`,
    name: 'A Minha Série Temporada 2 Episódio 5',
    type: 'series',
    episode: ['A Minha Série', 2, 5],
  },
  '"Season 1 - Episode 3"': {
    url: `${H}/hls/m8.m3u8`,
    name: 'English Show Season 1 - Episode 3',
    type: 'series',
    episode: ['English Show', 1, 3],
  },
  'scene-style "Breaking.Point.S01E01.720p"': {
    url: `${H}/files/bp.mkv`,
    name: 'Breaking.Point.S01E01.720p',
    type: 'series',
    episode: ['Breaking Point', 1, 1],
  },
  '"Show 4K S01E02" (quality tag before the marker)': {
    url: `${H}/hls/m9.m3u8`,
    name: 'Quality Show 4K S01E02',
    type: 'series',
    episode: ['Quality Show', 1, 2],
  },
  '"Show (HD) - S01E02 - Pilot"': {
    url: `${H}/hls/m10.m3u8`,
    name: 'Tagged Show (HD) - S01E02 - Pilot',
    type: 'series',
    episode: ['Tagged Show', 1, 2],
  },
  'specials "S00E01"': {
    url: `${H}/hls/m11.m3u8`,
    name: 'Show Extras S00E01',
    type: 'series',
    episode: ['Show Extras', 0, 1],
  },
  '"S01E02 - Pilot" without a show name uses the group': {
    attrs: 'group-title="Grupo da Série"',
    url: `${H}/files/p.mp4`,
    name: 'S01E02 - Pilot',
    type: 'series',
    episode: ['Grupo da Série', 1, 2],
  },

  // --- 7. False positives stay live ---
  'weak "1x02" alone (no other signal)': {
    url: `${H}/hls/f1.m3u8`,
    name: 'Show 1x02',
    type: 'live',
  },
  '"1x2" score in a sports group': {
    attrs: 'group-title="Desporto"',
    url: `${H}/hls/f2.m3u8`,
    name: 'Sporting 1x2 Braga',
    type: 'live',
  },
  'resolution "1920x1080"': {
    url: `${H}/hls/f3.m3u8`,
    name: 'Test Card 1920x1080',
    type: 'live',
  },
  'episode 0 is not a marker ("S01E00")': {
    url: `${H}/hls/f4.m3u8`,
    name: 'Odd S01E00',
    type: 'live',
  },
  'word containing "s1e2" is not a marker': {
    url: `${H}/hls/f5.m3u8`,
    name: 'Canal ABS1E2',
    type: 'live',
  },
  'channel "Sport TV 1 HD"': {
    attrs: 'group-title="Desporto"',
    url: `${H}/hls/f6.m3u8`,
    name: 'Sport TV 1 HD',
    type: 'live',
  },
};

function parseOne(c: Case) {
  const lines = [
    '#EXTM3U',
    `#EXTINF:-1 ${c.attrs ?? ''},${c.name}`,
    ...(c.extra ?? []),
    c.url,
  ].join('\n');
  const { entries } = parseM3uText(lines);
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

describe('classification table (VOD-04 AC1–AC4)', () => {
  it('has at least 40 cases', () => {
    expect(Object.keys(CASES).length).toBeGreaterThanOrEqual(40);
  });

  it.each(Object.entries(CASES))('%s', (_, c) => {
    const entry = parseOne(c);
    expect(entry.type).toBe(c.type);
    if (c.episode) {
      const [show, season, episode] = c.episode;
      expect(entry.episode).toMatchObject({ show, season, episode });
    } else {
      expect(entry.episode).toBeUndefined();
    }
  });
});

describe('episode markers', () => {
  it('splits the title after the marker, else keeps the whole name', () => {
    const one = parseOne({ url: `${H}/a.mp4`, name: 'Show - S01E02 - Pilot', type: 'series' });
    expect(one.episode?.title).toBe('Pilot');
    const two = parseOne({ url: `${H}/b.mp4`, name: 'Show S01E02', type: 'series' });
    expect(two.episode?.title).toBe('Show S01E02');
    const dated = parseOne({ url: `${H}/c.mp4`, name: 'ABC S14E08 25-10-2026', type: 'series' });
    expect(dated.episode?.title).toBe('25-10-2026');
  });

  it('the single marker parser (also used by the Series screens)', () => {
    expect(episodeMarker('Show S01E02')).toMatchObject({ season: 1, episode: 2 });
    expect(episodeMarker('Show S1 E12 - Title')).toMatchObject({ season: 1, episode: 12 });
    expect(episodeMarker('Show 2x05')).toMatchObject({ season: 2, episode: 5 });
    expect(episodeMarker('Show')).toBeUndefined();
    expect(episodeMarker('Show S01E00')).toBeUndefined();
    expect(episodeMarker('Temporada 2 e 3')).toBeUndefined();
    expect(strongEpisodeMarker('Temporada 2 Episódio 3')).toMatchObject({ season: 2, episode: 3 });
  });

  it('strong vs weak markers', () => {
    expect(strongEpisodeMarker('Show 1x02')).toBeUndefined();
    expect(episodeMarker('Show 1x02')).toMatchObject({ season: 1, episode: 2 });
    expect(episodeMarker('Score 1x2')).toBeUndefined();
    expect(strongEpisodeMarker('Show S10E120')).toMatchObject({ season: 10, episode: 120 });
  });

  it('show names: quality tags and separators removed, identity ignores case and accents', () => {
    expect(cleanShowName('Show Name [4K] - ')).toBe('Show Name');
    expect(cleanShowName('Glasd')).toBe('Glasd');
    expect(cleanShowName('Some.Show.2019.')).toBe('Some Show 2019');
    expect(showIdentity('Ação Total')).toBe(showIdentity('ACAO TOTAL'));
    expect(showIdentity('Show: Name')).toBe(showIdentity('Show - Name'));
    // Season tokens are not part of the group identity (review #4).
    const base = showGroupIdentity('Breaking Point');
    for (const group of [
      'Breaking Point T1',
      'Breaking Point T2',
      'Breaking Point Season 2',
      'Breaking Point - Temporada 2',
      'Breaking Point S02',
    ]) {
      expect(showGroupIdentity(group)).toBe(base);
    }
    expect(showGroupIdentity('Breaking Point 2')).not.toBe(base);
    expect(showGroupIdentity(undefined)).toBe('');
  });
});

describe('rules table', () => {
  it('classifyGroup: live words anywhere, keywords only as the leading significant word', () => {
    expect(classifyGroup('VOD')).toBe('vod');
    expect(classifyGroup('PT | Séries')).toBe('series');
    expect(classifyGroup('Canais | Filmes')).toBe('live');
    expect(classifyGroup('Filmes | Canais')).toBe('movie');
    expect(classifyGroup('Filmes 24/7')).toBe('live');
    expect(classifyGroup('Drama Series')).toBeUndefined();
    expect(classifyGroup('')).toBeUndefined();
    expect(classifyGroup(undefined)).toBeUndefined();
  });

  it('rules are configurable', () => {
    const rules: M3uClassificationRules = {
      ...DEFAULT_M3U_RULES,
      groupKeywords: { ...DEFAULT_M3U_RULES.groupKeywords, documentarios: 'movie' },
      groupLeadWords: 2,
      vodContainers: [...DEFAULT_M3U_RULES.vodContainers, 'webm'],
    };
    const input = { name: 'Planeta', path: '/a.m3u8', group: 'Documentários' };
    expect(classifyEntry(input).type).toBe('live');
    expect(classifyEntry(input, rules).type).toBe('movie');
    expect(classifyEntry({ ...input, group: 'Netflix Series' }, rules).type).toBe('series');
    expect(classifyEntry({ name: 'X', path: '/x.webm', container: 'webm' }, rules).type).toBe(
      'movie',
    );
    // Through the parser too.
    const { entries } = parseM3uText(
      `#EXTM3U\n#EXTINF:-1 group-title="Documentários",Planeta\n${H}/d.m3u8\n`,
    );
    expect(entries[0]?.type).toBe('live');
  });

  it('M3uClassifier caches the group decision per distinct group', () => {
    const classifier = new M3uClassifier();
    const groups = new Map<string, number>();
    const original = DEFAULT_M3U_RULES.groupKeywords;
    // Count lookups through a proxy of the keywords table.
    const counting = new Proxy(original, {
      get(target, key: string) {
        groups.set(key, (groups.get(key) ?? 0) + 1);
        return target[key];
      },
    });
    const cached = new M3uClassifier({ ...DEFAULT_M3U_RULES, groupKeywords: counting });
    for (let i = 0; i < 100; i++) {
      expect(cached.classify({ name: `Film ${i}`, path: '/f.m3u8', group: 'Filmes' }).type).toBe(
        'movie',
      );
      expect(
        classifier.classify({ name: `Film ${i}`, path: '/f.m3u8', group: 'Filmes' }).type,
      ).toBe('movie');
    }
    expect(groups.get('filmes')).toBe(1);
  });
});
