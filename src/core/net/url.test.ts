import { describe, expect, it } from 'vitest';
import {
  MAX_EXTERNAL_URL_LENGTH,
  displayUrl,
  parseExternalUrl,
  safeExternalLink,
  type ExternalUrlPurpose,
  type ExternalUrlRejection,
} from './url';

// Fictitious hosts and credentials only (CLAUDE.md).
const PURPOSES: ExternalUrlPurpose[] = ['source', 'stream', 'image', 'epg', 'link'];

describe('parseExternalUrl — accepted', () => {
  it.each([
    ['http://iptv.example.test', 'http://iptv.example.test/'],
    ['https://iptv.example.test/', 'https://iptv.example.test/'],
    ['HTTP://IPTV.Example.TEST/Path', 'http://iptv.example.test/Path'],
    ['  https://iptv.example.test/list.m3u  ', 'https://iptv.example.test/list.m3u'],
    ['\n\thttps://iptv.example.test/list.m3u\r\n', 'https://iptv.example.test/list.m3u'],
    ['http://iptv.example.test:8080', 'http://iptv.example.test:8080/'],
    ['https://iptv.example.test:443/x', 'https://iptv.example.test/x'],
    ['http://iptv.example.test:80/x', 'http://iptv.example.test/x'],
    ['http://192.0.2.10:25461/player_api.php', 'http://192.0.2.10:25461/player_api.php'],
    ['http://[2001:db8::1]/epg.xml', 'http://[2001:db8::1]/epg.xml'],
    ['http://[2001:db8::1]:8000/live', 'http://[2001:db8::1]:8000/live'],
    ['http://[::1]:5173/', 'http://[::1]:5173/'],
    ['http://localhost:8080/get.php', 'http://localhost:8080/get.php'],
    ['https://exämple.test/logo.png', 'https://xn--exmple-cua.test/logo.png'],
    ['https://логотип.example/a.png', 'https://xn--c1akhmbht.example/a.png'],
    [
      'http://iptv.example.test/get.php?username=u&password=p&type=m3u_plus',
      'http://iptv.example.test/get.php?username=u&password=p&type=m3u_plus',
    ],
    ['https://iptv.example.test/a b.png', 'https://iptv.example.test/a%20b.png'],
    ['https://iptv.example.test/#frag', 'https://iptv.example.test/#frag'],
  ])('%j → %s', (input, href) => {
    const result = parseExternalUrl(input, 'source');
    expect(result).toEqual({ ok: true, url: new URL(href) });
    if (result.ok) expect(result.url.href).toBe(href);
  });

  it.each(PURPOSES)('accepts a plain https URL for purpose %s', (purpose) => {
    expect(parseExternalUrl('https://iptv.example.test/x', purpose).ok).toBe(true);
  });
});

describe('parseExternalUrl — rejected', () => {
  it.each<[string, ExternalUrlRejection]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['\t\n', 'empty'],
    ['javascript:alert(1)', 'scheme'],
    [' JaVaScRiPt:alert(document.cookie)', 'scheme'],
    ['JAVASCRIPT:alert(1)', 'scheme'],
    ['java\tscript:alert(1)', 'invalid'],
    ['java\nscript:alert(1)', 'invalid'],
    ['java\rscript:alert(1)', 'invalid'],
    ['\u0000javascript:alert(1)', 'invalid'],
    ['\u0001javascript:alert(1)', 'invalid'],
    ['javascript\u0000:alert(1)', 'invalid'],
    ['http://iptv.example.test/\u0085x', 'invalid'],
    ['http://iptv.example.test/\u007fx', 'invalid'],
    ['javascript&#58;alert(1)', 'invalid'],
    ['vbscript:msgbox(1)', 'scheme'],
    ['VBScript:msgbox(1)', 'scheme'],
    ['data:text/html,<script>alert(1)</script>', 'scheme'],
    ['data:image/png;base64,iVBORw0KGgo=', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['blob:https://iptv.example.test/0b1c2d3e', 'scheme'],
    ['ftp://iptv.example.test/list.m3u', 'scheme'],
    ['rtmp://iptv.example.test/live', 'scheme'],
    ['ws://iptv.example.test/', 'scheme'],
    ['mailto:someone@example.test', 'scheme'],
    ['/relative/path.m3u', 'invalid'],
    ['relative/path.m3u', 'invalid'],
    ['./list.m3u', 'invalid'],
    ['//iptv.example.test/list.m3u', 'invalid'],
    ['?q=1', 'invalid'],
    ['http://', 'invalid'],
    ['https://:8080/x', 'invalid'],
    ['http://iptv.example.test:99999/', 'invalid'],
    ['http://[2001:db8::zz]/', 'invalid'],
    ['http://exa mple.test/', 'invalid'],
    ['<img src=x onerror=alert(1)>', 'invalid'],
    ['http://jdoe:abc123@iptv.example.test/list.m3u', 'credentials'],
    ['http://jdoe@iptv.example.test/list.m3u', 'credentials'],
    ['http://:abc123@iptv.example.test/list.m3u', 'credentials'],
    ['https://trusted.example.test@evil.example.test/', 'credentials'],
    ['HTTPS://JDOE:ABC123@IPTV.EXAMPLE.TEST/', 'credentials'],
    [`https://iptv.example.test/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`, 'too-long'],
    // Fits as input, but percent-encoding pushes the normalized href over the limit.
    [`https://iptv.example.test/${' '.repeat(MAX_EXTERNAL_URL_LENGTH - 100)}x`, 'too-long'],
  ])('%j → %s', (input, reason) => {
    expect(parseExternalUrl(input, 'source')).toEqual({ ok: false, reason });
  });

  it.each(PURPOSES)('rejects javascript: for purpose %s', (purpose) => {
    expect(parseExternalUrl('javascript:alert(1)', purpose)).toEqual({
      ok: false,
      reason: 'scheme',
    });
  });

  it('accepts a URL exactly at the length limit', () => {
    const prefix = 'https://iptv.example.test/';
    const input = prefix + 'a'.repeat(MAX_EXTERNAL_URL_LENGTH - prefix.length);
    expect(input).toHaveLength(MAX_EXTERNAL_URL_LENGTH);
    expect(parseExternalUrl(input, 'stream').ok).toBe(true);
  });

  it.each(PURPOSES)('rejects userinfo as credentials for purpose %s', (purpose) => {
    expect(parseExternalUrl('http://jdoe:abc123@iptv.example.test/', purpose)).toEqual({
      ok: false,
      reason: 'credentials',
    });
  });

  it('trims before checking the length', () => {
    const prefix = 'https://iptv.example.test/';
    const url = prefix + 'a'.repeat(MAX_EXTERNAL_URL_LENGTH - prefix.length);
    const padded = `${' '.repeat(100)}${url}${'\n'.repeat(100)}`;
    expect(padded.length).toBeGreaterThan(MAX_EXTERNAL_URL_LENGTH);
    expect(parseExternalUrl(padded, 'source').ok).toBe(true);
    expect(parseExternalUrl(`  ${url}a  `, 'source')).toEqual({ ok: false, reason: 'too-long' });
  });

  it('rejects pathological raw input (> 4x the limit) even if it trims to a valid URL', () => {
    const input = ' '.repeat(4 * MAX_EXTERNAL_URL_LENGTH) + 'https://iptv.example.test/';
    expect(parseExternalUrl(input, 'source')).toEqual({ ok: false, reason: 'too-long' });
    const justUnder = ' '.repeat(4 * MAX_EXTERNAL_URL_LENGTH - 30) + 'https://iptv.example.test/';
    expect(justUnder.length).toBeLessThanOrEqual(4 * MAX_EXTERNAL_URL_LENGTH);
    expect(parseExternalUrl(justUnder, 'source').ok).toBe(true);
  });
});

describe('displayUrl', () => {
  const show = (input: string) => displayUrl(new URL(input));

  it.each([
    ['http://iptv.example.test:8080/path', 'http://iptv.example.test:8080/path'],
    ['http://jdoe:abc123@iptv.example.test:8080/path', 'http://iptv.example.test:8080/path'],
    ['http://jdoe@iptv.example.test/list.m3u', 'http://iptv.example.test/list.m3u'],
    [
      'http://iptv.example.test/get.php?username=jdoe&password=abc123',
      'http://iptv.example.test/get.php',
    ],
    ['https://iptv.example.test/a#token=abc123', 'https://iptv.example.test/a'],
    ['https://iptv.example.test/', 'https://iptv.example.test'],
    ['https://iptv.example.test:443/', 'https://iptv.example.test'],
    ['http://[2001:db8::1]:8000/epg.xml', 'http://[2001:db8::1]:8000/epg.xml'],
    ['https://exämple.test/x', 'https://xn--exmple-cua.test/x'],
    // Xtream credential paths are masked by the log redactor.
    [
      'http://iptv.example.test:8080/live/jdoe/abc123/1.ts',
      'http://iptv.example.test:8080/live/***/***/1.ts',
    ],
    [
      'http://iptv.example.test/movie/jdoe/abc123/7.mp4',
      'http://iptv.example.test/movie/***/***/7.mp4',
    ],
    [
      'http://iptv.example.test/series/jdoe/abc123/9.mkv',
      'http://iptv.example.test/series/***/***/9.mkv',
    ],
    ['http://iptv.example.test/jdoe/abc123/123.ts', 'http://iptv.example.test/***/***/123.ts'],
    ['http://iptv.example.test/jdoe/abc123/123', 'http://iptv.example.test/***/***/123'],
    ['http://iptv.example.test/logos/a/b.png', 'http://iptv.example.test/logos/a/b.png'],
  ])('%s → %s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it('never contains userinfo, query or fragment', () => {
    const text = show('http://jdoe:abc123@iptv.example.test:8080/p?password=abc123#abc123');
    expect(text).not.toContain('jdoe');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('@');
    expect(text).not.toContain('?');
    expect(text).not.toContain('#');
  });

  it.each([
    'http://iptv.example.test/live/jdoe/abc123/1.ts',
    'http://iptv.example.test/jdoe/abc123/123.ts',
    'http://iptv.example.test:8080/timeshift/jdoe/abc123/60/2026-01-01:10-00/5.ts',
  ])('never contains Xtream path credentials: %s', (input) => {
    const text = show(input);
    expect(text).not.toContain('jdoe');
    expect(text).not.toContain('abc123');
  });
});

describe('safeExternalLink', () => {
  it.each([
    ['https://video.example.test/watch?v=abc', 'https://video.example.test/watch?v=abc'],
    ['http://video.example.test/trailer', 'http://video.example.test/trailer'],
    ['  https://VIDEO.example.test/t  ', 'https://video.example.test/t'],
  ])('%j → link to %s', (input, href) => {
    expect(safeExternalLink(input)).toEqual({ href, rel: 'noopener noreferrer', target: '_blank' });
  });

  it.each([
    '',
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative',
    'https://trusted.example.test@evil.example.test/',
    'https://user:pass@video.example.test/',
  ])('%j → undefined', (input) => {
    expect(safeExternalLink(input)).toBeUndefined();
  });
});
