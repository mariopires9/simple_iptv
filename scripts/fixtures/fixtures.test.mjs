// @vitest-environment node
// Invariants of the committed synthetic fixtures and the fixture generators (QA-01).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createRng, generateM3uLines } from './generate-m3u.mjs';
import { gzipDeterministic } from './gzip-xmltv.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = join(ROOT, 'fixtures');
const read = (p) => readFileSync(join(FIXTURES, p));
const text = (p) => read(p).toString('utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('fixtures are synthetic only (QA-01 AC4)', () => {
  const textFiles = walk(FIXTURES).filter((f) => /\.(json|m3u|m3u8|xml|vtt|md)$/.test(f));

  it.each(textFiles.map((f) => relative(FIXTURES, f)))(
    '%s only references reserved hosts',
    (file) => {
      const content = readFileSync(join(FIXTURES, file), 'utf8');
      const hosts = [
        ...content.matchAll(/\b(?:https?|rtmp|udp):\/\/(?:[^@/\s"']*@)?([^/:\s"'?#]*)/g),
      ].map((m) => m[1]);
      const allowed = (h) =>
        h === '' ||
        h.endsWith('.example.test') ||
        h === '127.0.0.1' ||
        h === '239.0.0.1' ||
        h === 'creativecommons.org';
      expect(hosts.filter((h) => !allowed(h))).toEqual([]);
    },
  );

  it('total committed fixture size stays under 2 MB', () => {
    const total = walk(FIXTURES).reduce((n, f) => n + statSync(f).size, 0);
    expect(total).toBeLessThan(2 * 1024 * 1024);
  });
});

// Review finding 4: git must never normalise line endings of any committed fixture.
describe('.gitattributes keeps fixtures byte-exact', () => {
  let gitAvailable = true;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    gitAvailable = false;
  }
  const files = walk(FIXTURES)
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('README.md'));

  it.skipIf(!gitAvailable)('every fixture has text unset (-text or binary)', () => {
    const out = execFileSync('git', ['check-attr', 'text', '--', ...files], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const notUnset = out
      .trim()
      .split('\n')
      .filter((line) => !line.endsWith(': text: unset'));
    expect(notUnset).toEqual([]);
  });
});

describe('xtream fixtures', () => {
  const json = (p) => JSON.parse(text(`xtream/${p}`));

  it('auth fixtures describe ok / fail / expired / banned accounts', () => {
    expect(json('auth-ok.json').user_info).toMatchObject({
      auth: 1,
      status: 'Active',
      username: 'jdoe',
    });
    expect(json('auth-fail.json').user_info.auth).toBe(0);
    expect(json('account-expired.json').user_info.status).toBe('Expired');
    expect(json('account-banned.json').user_info.status).toBe('Banned');
    expect(json('auth-ok.json').server_info.https_port).toBe('');
    expect(json('server-info-https.json').server_info.https_port).toBe('8443');
  });

  it('series info exists with episodes as object and as array', () => {
    expect(Array.isArray(json('series-info-episodes-object.json').episodes)).toBe(false);
    expect(Array.isArray(json('series-info-episodes-array.json').episodes)).toBe(true);
  });

  it('short EPG titles and descriptions are base64 UTF-8 with accents', () => {
    const decoded = json('short-epg.json').epg_listings.flatMap((l) => [
      Buffer.from(l.title, 'base64').toString('utf8'),
      Buffer.from(l.description, 'base64').toString('utf8'),
    ]);
    expect(decoded.join(' ')).toMatch(/ção/);
    expect(decoded.join(' ')).toMatch(/Notícias/);
  });
});

describe('m3u fixtures', () => {
  it('crlf-bom.m3u starts with a UTF-8 BOM and uses CRLF only', () => {
    const buf = read('m3u/crlf-bom.m3u');
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const s = buf.toString('utf8');
    expect(s).toContain('\r\n');
    expect(s.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('malicious.m3u contains hostile URLs, markup and a 100 KB attribute', () => {
    const s = text('m3u/malicious.m3u');
    for (const needle of ['javascript:', 'data:', 'file:', '<script>', 'onerror=']) {
      expect(s).toContain(needle);
    }
    expect(s.split('\n').some((line) => line.length > 100 * 1024)).toBe(true);
  });

  it('attributes-edge-cases.m3u covers the RESEARCH §8 syntax', () => {
    const s = text('m3u/attributes-edge-cases.m3u');
    for (const needle of [
      'url-tvg=',
      'x-tvg-url=',
      "tvg-id='",
      'tvg-chno=',
      'catchup=',
      '#EXTVLCOPT:',
      '#KODIPROP:',
      '#EXTGRP:',
    ]) {
      expect(s).toContain(needle);
    }
  });

  it('vod-series-patterns.m3u covers path and name patterns', () => {
    const s = text('m3u/vod-series-patterns.m3u');
    for (const needle of [
      '/movie/',
      '/series/',
      'S01E02',
      '1x02',
      '"VOD"',
      'Movies',
      'Filmes',
      'Series',
      'Séries',
    ]) {
      expect(s).toContain(needle);
    }
  });

  it('malformed.m3u has no #EXTM3U header on the first line', () => {
    expect(text('m3u/malformed.m3u').startsWith('#EXTM3U')).toBe(false);
  });
});

describe('xmltv fixtures', () => {
  it('small.xml.gz is the deterministic gzip of small.xml', () => {
    const xml = read('xmltv/small.xml');
    const gz = read('xmltv/small.xml.gz');
    expect(gunzipSync(gz).equals(xml)).toBe(true);
    expect(gzipDeterministic(xml).equals(gz)).toBe(true);
  });

  it('small.xml has 2 channels, ~10 programmes, both timezones, entities and CDATA', () => {
    const s = text('xmltv/small.xml');
    expect(s.match(/<channel /g)).toHaveLength(2);
    expect((s.match(/<programme /g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(s).toContain('+0000"');
    expect(s).toContain('+0100"');
    expect(s).toContain('&amp;');
    expect(s).toContain('<![CDATA[');
  });
});

/** Elementary stream types declared in the first PMT of an MPEG-TS buffer. */
function tsStreamTypes(buf) {
  let pmtPid = -1;
  for (let i = 0; i + 188 <= buf.length; i += 188) {
    if (buf[i] !== 0x47) throw new Error(`lost sync at ${i}`);
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if ((buf[i + 1] & 0x40) === 0) continue;
    let p = i + 4;
    if (buf[i + 3] & 0x20) p += 1 + buf[p];
    p += 1 + buf[p]; // pointer field
    if (pid === 0) pmtPid = ((buf[p + 10] & 0x1f) << 8) | buf[p + 11];
    else if (pid === pmtPid) {
      const end = p + 3 + (((buf[p + 1] & 0x0f) << 8) | buf[p + 2]) - 4;
      let q = p + 12 + (((buf[p + 10] & 0x0f) << 8) | buf[p + 11]);
      const types = [];
      while (q < end) {
        types.push(buf[q]);
        q += 5 + (((buf[q + 3] & 0x0f) << 8) | buf[q + 4]);
      }
      return types;
    }
  }
  return [];
}

describe('stream fixtures', () => {
  it.each([
    ['streams/ts/h264-aac.ts', [0x1b, 0x0f]],
    ['streams/ts/h264-ac3.ts', [0x1b, 0x81]],
    ['streams/hls/seg00.ts', [0x1b, 0x0f]],
    ['streams/hls-multi/video_00.ts', [0x1b]],
    ['streams/hls-multi/audio_pt_00.ts', [0x0f]],
  ])('%s is MPEG-TS with stream types %o (H.264=0x1b, AAC=0x0f, AC-3=0x81)', (file, types) => {
    const buf = read(file);
    expect(buf.length % 188).toBe(0);
    expect(tsStreamTypes(buf)).toEqual(types);
  });

  it('mp4 is faststart (moov before mdat)', () => {
    const s = read('streams/mp4/h264-aac.mp4').toString('latin1');
    expect(s.slice(4, 8)).toBe('ftyp');
    expect(s.indexOf('moov')).toBeGreaterThan(0);
    expect(s.indexOf('moov')).toBeLessThan(s.indexOf('mdat'));
  });

  it('multi-audio master playlist has en/pt audio renditions and an en subtitle rendition', () => {
    const m = text('streams/hls-multi/master.m3u8');
    expect(m.match(/TYPE=AUDIO/g)).toHaveLength(2);
    expect(m).toContain('LANGUAGE="en"');
    expect(m).toContain('LANGUAGE="pt"');
    expect(m).toContain('TYPE=SUBTITLES');
    for (const uri of [...m.matchAll(/URI="([^"]+)"/g)].map((x) => x[1])) {
      expect(statSync(join(FIXTURES, 'streams/hls-multi', uri)).isFile()).toBe(true);
    }
  });

  it('every segment referenced by a media playlist exists', () => {
    for (const pl of [
      'hls/index.m3u8',
      'hls-multi/video.m3u8',
      'hls-multi/audio_en.m3u8',
      'hls-multi/audio_pt.m3u8',
      'hls-multi/subs/en.m3u8',
    ]) {
      const dir = join(FIXTURES, 'streams', pl, '..');
      const uris = text(`streams/${pl}`)
        .split('\n')
        .filter((l) => l && !l.startsWith('#'));
      expect(uris.length).toBeGreaterThan(0);
      for (const uri of uris) expect(statSync(join(dir, uri)).isFile()).toBe(true);
    }
  });
});

describe('generate-m3u.mjs', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = [...generateM3uLines(200, 1)].join('\n');
    const b = [...generateM3uLines(200, 1)].join('\n');
    const c = [...generateM3uLines(200, 2)].join('\n');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(createRng(5)()).toBe(createRng(5)());
  });

  it('produces count entries with a header and only example.test hosts', () => {
    const lines = [...generateM3uLines(1000)];
    expect(lines[0]).toMatch(/^#EXTM3U/);
    expect(lines).toHaveLength(1 + 2 * 1000);
    expect(
      lines
        .filter((l) => l.startsWith('http'))
        .every((l) => l.startsWith('http://stream.example.test/')),
    ).toBe(true);
  });

  it('CLI writes 50k entries to a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm3u-'));
    try {
      const out = join(dir, 'big.m3u');
      execFileSync(process.execPath, [
        join(ROOT, 'scripts/fixtures/generate-m3u.mjs'),
        '50000',
        out,
        '--seed',
        '3',
      ]);
      const content = readFileSync(out, 'utf8');
      expect(content.split('\n').filter((l) => l.startsWith('#EXTINF')).length).toBe(50000);
      expect(content).toBe([...generateM3uLines(50000, 3)].join('\n') + '\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
