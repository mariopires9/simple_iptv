// @vitest-environment node
// SRC-04: streaming M3U parser — every synthetic fixture in fixtures/m3u, chunk-boundary property
// test, flags (AC8), classification (AC7) and the 64 KB line cap.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  M3uParser,
  MAX_LINE_LENGTH,
  MAX_NAME_LENGTH,
  feedM3uStream,
  parseM3uText,
  parseTagBody,
  type M3uEntry,
} from './parser';

const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/m3u/${name}`, import.meta.url)));
const fixture = (name: string): string => new TextDecoder().decode(fixtureBytes(name));

const FIXTURES = [
  'attributes-edge-cases.m3u',
  'basic.m3u',
  'crlf-bom.m3u',
  'malformed.m3u',
  'malicious.m3u',
  'vod-series-patterns.m3u',
];

function streamOf(bytes: Uint8Array, cuts: number[]): ReadableStream<Uint8Array> {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    parts.push(bytes.subarray(start, cut));
    start = cut;
  }
  return new ReadableStream({
    pull(controller) {
      const next = parts.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
}

async function parseBytes(bytes: Uint8Array, cuts: number[] = []) {
  const entries: M3uEntry[] = [];
  const parser = new M3uParser({ onEntry: (e) => entries.push(e) });
  const completed = await feedM3uStream(streamOf(bytes, cuts), parser);
  return {
    completed,
    entries,
    header: parser.header,
    stats: parser.stats,
    first: parser.firstLine,
  };
}

/** mulberry32 (same as scripts/fixtures/generate-m3u.mjs). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byName = (entries: M3uEntry[], name: string) => {
  const found = entries.find((e) => e.name === name);
  if (!found) throw new Error(`no entry named ${name}`);
  return found;
};

describe('parseTagBody', () => {
  it('reads duration, quoted/unquoted attributes and a name with commas', () => {
    const r = parseTagBody(`-1 tvg-id="a" tvg-name='B, c' group-title=G x ,Name, with comma`, true);
    expect(r.duration).toBe(-1);
    expect(Object.fromEntries(r.attrs)).toEqual({
      'tvg-id': 'a',
      'tvg-name': 'B, c',
      'group-title': 'G',
    });
    expect(r.name).toBe('Name, with comma');
  });

  it('keeps the first occurrence of a key and lower-cases keys', () => {
    const r = parseTagBody(`-1 TVG-ID="first" tvg-id="second",N`, true);
    expect(r.attrs.get('tvg-id')).toBe('first');
  });

  it('without a comma, leftover bare words become the name', () => {
    expect(parseTagBody(`-1 group-title="G" Bare Name`, true).name).toBe('Bare Name');
  });
});

describe('fixtures', () => {
  it('basic.m3u: attributes, groups and classification', () => {
    const { entries, stats, header, firstLine } = parseM3uText(fixture('basic.m3u'));
    expect(firstLine).toBe('header');
    expect(header.epgUrls).toEqual([]);
    expect(stats.skipped).toBe(0);
    expect(entries.map((e) => [e.name, e.group, e.type, e.container])).toEqual([
      ['Example News HD', 'News', 'live', 'hls'],
      ['Notícias Exemplo', 'News', 'live', 'ts'],
      ['Test Sports 1', 'Sports', 'live', 'hls'],
      ['Demo Kids', 'Kids', 'live', 'ts'],
      ['The Synthetic Movie (2024)', 'Movies', 'movie', 'mp4'],
    ]);
    expect(entries[0]?.attrs).toEqual({
      tvgId: 'news.example.test',
      tvgName: 'Example News HD',
      tvgLogo: 'http://img.example.test/logos/1001.png',
      groupTitle: 'News',
    });
    expect(entries[0]?.duration).toBe(-1);
  });

  it('attributes-edge-cases.m3u: AC1–AC3 syntax', () => {
    const { entries, header, stats } = parseM3uText(fixture('attributes-edge-cases.m3u'));
    // AC2: both header attributes captured.
    expect(header.epgUrls).toEqual([
      'http://epg.example.test/guide.xml.gz',
      'http://epg.example.test/alt.xml',
    ]);
    expect(byName(entries, 'Single Quotes').attrs).toMatchObject({
      tvgId: 'single.example.test',
      tvgLogo: 'http://img.example.test/b.png',
      groupTitle: 'Quotes',
    });
    expect(byName(entries, 'Unquoted Attributes').attrs).toMatchObject({
      tvgId: 'unquoted.example.test',
      tvgChno: '7',
      groupTitle: 'Unquoted',
    });
    const commas = byName(entries, 'News, Weather, Sport');
    expect(commas.attrs.tvgName).toBe('News, Weather, Sport');
    expect(commas.group).toBe('Commas, In, Group');
    expect(byName(entries, `It's a "Quoted" Channel`).attrs.tvgName).toBe(`It's a Channel`);
    expect(byName(entries, 'Channel 101').attrs.tvgChno).toBe('101');
    expect(byName(entries, 'Catch-up Channel').attrs).toMatchObject({
      catchup: 'default',
      catchupDays: '7',
      catchupSource: 'http://stream.example.test/timeshift/{utc}/{duration}/6.ts',
      timeshift: '7',
    });
    expect(byName(entries, 'Shift Catch-up').attrs.catchup).toBe('shift');
    // AC3: options attach to the next entry.
    const vlc = byName(entries, 'VLC Options Channel');
    expect(vlc.vlcOpts.map((o) => o.key)).toEqual([
      'http-user-agent',
      'http-referrer',
      'network-caching',
    ]);
    expect(vlc.requiredHeaders).toEqual(['user-agent', 'referer']);
    const kodi = byName(entries, 'Kodi Props Channel');
    expect(kodi.kodiProps).toHaveLength(2);
    expect(kodi.drm).toBe(false);
    expect(kodi.vlcOpts).toEqual([]);
    expect(byName(entries, 'EXTGRP Only Group').group).toBe('Group From EXTGRP');
    const both = byName(entries, 'Both Groups');
    expect(both.group).toBe('Attribute Group');
    expect(both.extGrp).toBe('Ignored EXTGRP');
    expect(byName(entries, 'Duration Zero').duration).toBe(0);
    const positive = byName(entries, 'Positive Duration No Attributes');
    expect(positive.duration).toBe(3600.5);
    expect(positive.group).toBeUndefined();
    expect(byName(entries, 'Spaced Out Name').attrs).toMatchObject({
      tvgName: 'Spaced Out',
      groupTitle: 'Spacing',
    });
    expect(byName(entries, 'Upper-case Attribute Keys').attrs).toMatchObject({
      tvgId: 'upper.example.test',
      groupTitle: 'Case',
    });
    // Empty name and tvg-name: falls back to tvg-id; empty attributes are absent.
    const empty = byName(entries, 'empty.example.test');
    expect(empty.attrs.tvgLogo).toBeUndefined();
    expect(empty.group).toBeUndefined();
    expect(entries.some((e) => e.name.includes('ção'))).toBe(true);
    expect(byName(entries, 'URL With Query and Fragment').url).toBe(
      'http://stream.example.test/live/18.m3u8?token=synthetic-token&a=1#frag',
    );
    expect(byName(entries, 'Blank Line Before URL').url).toBe(
      'http://stream.example.test/live/19.m3u8',
    );
    // rtmp:// and udp:// are not playable in a browser.
    expect(stats.skippedByReason['unsupported-scheme']).toBe(2);
    expect(stats.skipped).toBe(2);
    expect(entries).toHaveLength(20);
  });

  it('crlf-bom.m3u: BOM and CRLF, no trailing newline (AC4)', async () => {
    const bytes = fixtureBytes('crlf-bom.m3u');
    const { entries, header, first } = await parseBytes(bytes);
    expect(first).toBe('header');
    expect(header.epgUrls).toEqual(['http://epg.example.test/guide.xml']);
    expect(entries.map((e) => e.name)).toEqual([
      'CRLF Channel One',
      'Canal Ação',
      'Last Channel Without Trailing Newline',
    ]);
    expect(entries.every((e) => !/[\r\n]/.test(e.url + e.name))).toBe(true);
    expect(entries[2]?.url).toBe('http://stream.example.test/live/3.m3u8');
    // Also as a string (the BOM survives a raw decode).
    expect(parseM3uText(`\uFEFF${fixture('crlf-bom.m3u')}`).entries).toHaveLength(3);
  });

  it('malformed.m3u: tolerant, counts what it skips (AC4, AC5)', () => {
    const { entries, stats, firstLine } = parseM3uText(fixture('malformed.m3u'));
    // No #EXTM3U header: starts directly with an entry (accepted by the import, AC4).
    expect(firstLine).toBe('extinf');
    const names = entries.map((e) => e.name);
    expect(names).toContain('First Entry Without #EXTM3U Header');
    expect(names).toContain('Entry After Missing URL');
    expect(names).toContain('Unterminated Quote');
    expect(names).toContain('No Comma Before Name');
    expect(names).toContain('Missing Duration And Colon');
    expect(names).toContain('Non-numeric Duration');
    expect(names).toContain('After Duplicate #EXTM3U Header');
    expect(names).toContain('After Unknown Tag');
    expect(names).toContain('After Whitespace-only Line');
    // Empty name → last path segment.
    expect(names).toContain('8-empty-name');
    expect(byName(entries, 'URL With Spaces').url).toBe(
      'http://stream.example.test/live/with%20space.m3u8',
    );
    expect(stats.skippedByReason['missing-url']).toBe(2); // no-url + truncated at EOF
    expect(stats.skippedByReason['no-extinf']).toBe(1); // orphan URL
    expect(stats.skippedByReason['invalid-url']).toBe(2); // "not a url at all", relative
    expect(stats.skipped).toBe(5);
  });

  it('malicious.m3u: hostile schemes skipped, markup kept as inert text (AC5)', () => {
    const { entries, stats, header } = parseM3uText(fixture('malicious.m3u'));
    expect(header.epgUrls).toEqual([]);
    expect(stats.skippedByReason['unsupported-scheme']).toBe(5);
    // The 100 KB line exceeds the cap: its entry is skipped, the parser carries on.
    expect(stats.longLines).toBe(1);
    expect(stats.skippedByReason['line-too-long']).toBe(1);
    expect(entries.every((e) => /^https?:\/\//.test(e.url))).toBe(true);
    expect(entries.map((e) => e.name)).toContain('Safe Channel After Hostile Entries');
    const proto = byName(entries, '__proto__ Attribute');
    expect(Object.getPrototypeOf(proto.attrs)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    const control = entries.find((e) => e.attrs.tvgId === 'control-chars');
    // eslint-disable-next-line no-control-regex
    expect(control?.name).not.toMatch(/[\u0000-\u001f‮]/);
    expect(entries.every((e) => e.name.length <= MAX_NAME_LENGTH)).toBe(true);
    // Markup is not interpreted, only stored as text.
    expect(entries.some((e) => e.name === '<script>alert("name")</script>')).toBe(true);
  });

  it('vod-series-patterns.m3u: classification by path, group, extension and marker (VOD-04)', () => {
    const { entries } = parseM3uText(fixture('vod-series-patterns.m3u'));
    const types = Object.fromEntries(entries.map((e) => [e.name, e.type]));
    expect(types['Plain Live Channel']).toBe('live');
    expect(types['The Synthetic Movie (2024)']).toBe('movie');
    expect(types['Test Pattern Returns']).toBe('movie');
    expect(types['Example Drama S01E01']).toBe('series');
    expect(types['A Série de Teste 1x01']).toBe('series');
    expect(types['Documentary By Group Prefix Only']).toBe('movie');
    expect(types['Movie By Extension Only']).toBe('movie');
    expect(types['Pattern Without Series Path S03E10']).toBe('series');
    expect(types['Test Sports 1x2 Live (not an episode)']).toBe('live');
    expect(types['Movie 1984 (not an episode)']).toBe('movie');
    expect(entries.filter((e) => e.type === 'movie')).toHaveLength(6);
    expect(entries.filter((e) => e.type === 'series')).toHaveLength(7);
    const drama = entries.find((e) => e.name === 'Example Drama S02 E01');
    expect(drama?.episode).toEqual({
      season: 2,
      episode: 1,
      show: 'Example Drama',
      title: drama?.name,
    });
  });
});

describe('AC8 flags', () => {
  const list = [
    '#EXTM3U',
    '#EXTINF:-1,DRM',
    '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
    '#KODIPROP:inputstream.adaptive.license_key=https://lic.example.test/x',
    'https://s.example.test/drm/manifest.mpd',
    '#EXTINF:-1,Headers',
    '#EXTVLCOPT:http-user-agent=Agent/1.0',
    '#EXTVLCOPT:http-referrer=https://www.example.test/',
    '#EXTVLCOPT:http-origin=https://www.example.test',
    'https://s.example.test/h/index.m3u8',
    '#EXTINF:-1,Kodi pipe headers',
    'https://s.example.test/k/index.m3u8|User-Agent=Foo&Referer=https://r.example.test/',
    '#EXTINF:-1,Dash by manifest type',
    '#KODIPROP:inputstream.adaptive.manifest_type=mpd',
    'https://s.example.test/d/stream',
    '#EXTINF:-1 radio="true",Radio',
    'https://s.example.test/radio/live.m3u8',
    '#EXTINF:-1,Audio file',
    'https://s.example.test/a/stream.mp3',
    '#EXTINF:-1,Plain',
    'https://s.example.test/p/1.ts',
  ].join('\n');
  const { entries } = parseM3uText(list);

  it('drm from KODIPROP license_*; dash from .mpd', () => {
    expect(byName(entries, 'DRM')).toMatchObject({ drm: true, container: 'dash' });
  });
  it('requiredHeaders from EXTVLCOPT and from the Kodi pipe suffix', () => {
    expect(byName(entries, 'Headers').requiredHeaders).toEqual(['user-agent', 'referer', 'origin']);
    const pipe = byName(entries, 'Kodi pipe headers');
    expect(pipe.requiredHeaders).toEqual(['user-agent', 'referer']);
    expect(pipe.url).toBe('https://s.example.test/k/index.m3u8');
  });
  it('dash from KODIPROP manifest_type', () => {
    expect(byName(entries, 'Dash by manifest type').container).toBe('dash');
  });
  it('audioOnly from radio="true" and audio extensions', () => {
    expect(byName(entries, 'Radio')).toMatchObject({ audioOnly: true, container: 'hls' });
    expect(byName(entries, 'Audio file')).toMatchObject({ audioOnly: true, container: 'mp3' });
  });
  it('a plain entry has no flags', () => {
    expect(byName(entries, 'Plain')).toMatchObject({
      drm: false,
      requiredHeaders: [],
      audioOnly: false,
      container: 'ts',
    });
  });
  it('options do not leak into the following entry', () => {
    expect(byName(entries, 'Kodi pipe headers').vlcOpts).toEqual([]);
    expect(byName(entries, 'Headers').kodiProps).toEqual([]);
  });
});

describe('robustness', () => {
  it('splits comma-separated url-tvg values and dedupes across headers (AC2)', () => {
    const { header } = parseM3uText(
      [
        '#EXTM3U url-tvg="https://e.example.test/a.xml.xz, https://e.example.test/b.xml.xz" x-tvg-url="https://e.example.test/a.xml.xz"',
        '#EXTM3U x-tvg-url="javascript:alert(1),https://e.example.test/c.xml"',
      ].join('\n'),
    );
    expect(header.epgUrls).toEqual([
      'https://e.example.test/a.xml.xz',
      'https://e.example.test/b.xml.xz',
      'https://e.example.test/c.xml',
    ]);
  });

  it('URLs with userinfo are skipped with their own reason', () => {
    const { stats, entries } = parseM3uText(
      '#EXTM3U\n#EXTINF:-1,X\nhttp://u:p@h.example.test/1.ts',
    );
    expect(entries).toEqual([]);
    expect(stats.skippedByReason['credentials-url']).toBe(1);
  });

  it('a line over the cap is dropped without buffering it, the next entry survives', () => {
    const huge = 'x'.repeat(MAX_LINE_LENGTH + 10);
    const text = `#EXTM3U\n#EXTINF:-1 tvg-logo="${huge}",Big\nhttp://h.example.test/1.ts\n#EXTINF:-1,Ok\nhttp://h.example.test/2.ts\n`;
    const entries: M3uEntry[] = [];
    const parser = new M3uParser({ onEntry: (e) => entries.push(e) });
    // Feed in small pieces: the partial buffer must never grow past the cap.
    for (let i = 0; i < text.length; i += 1000) {
      parser.write(text.slice(i, i + 1000));
      expect((parser as unknown as { partial: string }).partial.length).toBeLessThanOrEqual(
        MAX_LINE_LENGTH,
      );
    }
    const stats = parser.end();
    expect(entries.map((e) => e.name)).toEqual(['Ok']);
    expect(stats.skippedByReason['line-too-long']).toBe(1);
  });

  it('lone CR line endings are accepted', () => {
    const { entries } = parseM3uText('#EXTM3U\r#EXTINF:-1,A\rhttp://h.example.test/a.ts\r');
    expect(entries.map((e) => e.name)).toEqual(['A']);
  });

  it('the first non-blank line decides firstLine (HTML is not a header)', () => {
    expect(parseM3uText('\n\n  <!doctype html><html></html>').firstLine).toBe('other');
    expect(parseM3uText('\n#extm3u\n').firstLine).toBe('header');
    expect(parseM3uText('').firstLine).toBeUndefined();
  });

  it('write after end throws', () => {
    const parser = new M3uParser({ onEntry: () => undefined });
    parser.end();
    expect(() => parser.write('x')).toThrow();
  });

  it('onChunk returning false stops the stream early', async () => {
    const bytes = fixtureBytes('basic.m3u');
    const parser = new M3uParser({ onEntry: () => undefined });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes.subarray(0, 10));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await feedM3uStream(stream, parser, { onChunk: () => false })).toBe(false);
    expect(cancelled).toBe(true);
  });
});

describe('chunk-boundary property', () => {
  // Random byte-level splits (including inside multi-byte UTF-8 characters, CRLF pairs and the BOM)
  // must give exactly the same output as parsing in one piece.
  for (const name of FIXTURES) {
    it(`${name}: 40 random chunkings give identical output`, async () => {
      const bytes = fixtureBytes(name);
      const reference = await parseBytes(bytes);
      expect(reference.completed).toBe(true);
      const random = rng(name.length * 7919);
      for (let run = 0; run < 40; run++) {
        const count = 1 + Math.floor(random() * (run < 20 ? 8 : 200));
        const cuts = Array.from({ length: count }, () => Math.floor(random() * bytes.length));
        cuts.sort((a, b) => a - b);
        const result = await parseBytes(bytes, cuts);
        expect(result.entries).toEqual(reference.entries);
        expect(result.header).toEqual(reference.header);
        expect(result.stats).toEqual(reference.stats);
        expect(result.first).toEqual(reference.first);
      }
    });
  }

  it('one byte at a time', async () => {
    const bytes = fixtureBytes('attributes-edge-cases.m3u');
    const reference = await parseBytes(bytes);
    const cuts = Array.from({ length: bytes.length - 1 }, (_, i) => i + 1);
    const result = await parseBytes(bytes, cuts);
    expect(result.entries).toEqual(reference.entries);
    expect(result.stats).toEqual(reference.stats);
  });
});
