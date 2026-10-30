// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_URL_BYTES,
  b64uDecode,
  b64uEncode,
  buildHealthUrl,
  buildProxyUrl,
  parseProxyPath,
  parseUpstreamUrl,
  sanitizeName,
} from './url.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-AB';

describe('b64u', () => {
  it('round-trips UTF-8 URLs without padding or +/', () => {
    for (const text of ['http://a.test/', 'http://a.test/ç~?x=ü&y=😀', 'h', 'ht', 'htt']) {
      const encoded = b64uEncode(text);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(b64uDecode(encoded)).toBe(text);
    }
  });

  it.each([
    ['empty', ''],
    ['padding', 'aHR0cA=='],
    ['standard alphabet', 'a+b/'],
    ['impossible length', 'abcde'],
    ['non-canonical trailing bits', 'aHR0cB'],
    ['invalid UTF-8', b64uEncode('x').replace(/./, '_')],
  ])('rejects %s', (_label, value) => {
    expect(b64uDecode(value)).toBeNull();
  });

  it('rejects more than 8 KiB decoded', () => {
    expect(b64uDecode(b64uEncode('a'.repeat(MAX_URL_BYTES)))).toBe('a'.repeat(MAX_URL_BYTES));
    expect(b64uDecode(b64uEncode('a'.repeat(MAX_URL_BYTES + 1)))).toBeNull();
  });
});

describe('parseUpstreamUrl', () => {
  it('accepts absolute http(s) URLs and drops the fragment', () => {
    const result = parseUpstreamUrl('https://Panel.Example.com:8443/live/u/p/1.ts?x=1#frag');
    expect(result.ok && result.url.href).toBe('https://panel.example.com:8443/live/u/p/1.ts?x=1');
  });

  it.each([
    ['ftp://a.test/x', 'bad-scheme'],
    ['javascript:alert(1)', 'bad-scheme'],
    ['http://user:pw@a.test/', 'userinfo'],
    ['http://user@a.test/', 'userinfo'],
    ['/relative', 'bad-url'],
    ['http://a.test/\nx', 'bad-url'],
    ['http://a.test/ x', 'bad-url'],
    [`http://a.test/${'a'.repeat(MAX_URL_BYTES)}`, 'too-long'],
  ])('rejects %s', (text, error) => {
    expect(parseUpstreamUrl(text)).toEqual({ ok: false, error });
  });
});

describe('sanitizeName', () => {
  it.each([
    ['http://a.test/live/u/p/123.ts', '123.ts'],
    ['http://a.test/hls/index.m3u8?token=1', 'index.m3u8'],
    ['http://a.test/path/', 'path'],
    ['http://a.test/', '_'],
    ['http://a.test/a%2Fb', '_'],
    ['http://a.test/espaço.ts', '_'],
    ['http://a.test/..%2E', '_'],
    [`http://a.test/${'x'.repeat(65)}`, '_'],
    ['not a url', '_'],
  ])('%s → %s', (url, name) => {
    expect(sanitizeName(url)).toBe(name);
  });
});

describe('buildProxyUrl / parseProxyPath', () => {
  const upstream = 'http://panel.example.com/live/u/p/42.ts';

  it('builds u URLs that parse back (base with path prefix and trailing slash)', () => {
    const url = buildProxyUrl('https://pc.tailnet.ts.net/iptv/', TOKEN, upstream);
    expect(url).toBe(`https://pc.tailnet.ts.net/iptv/v1/${TOKEN}/u/${b64uEncode(upstream)}/42.ts`);
    const parsed = parseProxyPath(new URL(url).pathname.replace('/iptv', ''));
    expect(parsed).toEqual({ ok: true, token: TOKEN, route: { kind: 'u', target: upstream } });
  });

  it('builds g URLs carrying the grant', () => {
    const grant = 'abc123.ABCDEFGHIJKLMNOPQRSTUV';
    const url = buildProxyUrl('https://pc.tailnet.ts.net', TOKEN, upstream, grant);
    expect(parseProxyPath(new URL(url).pathname)).toEqual({
      ok: true,
      token: TOKEN,
      route: { kind: 'g', grant, target: upstream },
    });
  });

  it('builds and parses health URLs', () => {
    expect(buildHealthUrl('https://h.test/', TOKEN)).toBe(`https://h.test/v1/${TOKEN}/health`);
    const withTarget = new URL(buildHealthUrl('https://h.test', TOKEN, upstream)).pathname;
    expect(parseProxyPath(withTarget)).toEqual({
      ok: true,
      token: TOKEN,
      route: { kind: 'health', target: upstream },
    });
    expect(parseProxyPath(`/v1/${TOKEN}/health`)).toEqual({
      ok: true,
      token: TOKEN,
      route: { kind: 'health' },
    });
  });

  it('separates not-found from malformed (malformed keeps the token for the 401 check)', () => {
    expect(parseProxyPath('/')).toEqual({ ok: false, error: 'not-found' });
    expect(parseProxyPath('/v2/x/health')).toEqual({ ok: false, error: 'not-found' });
    const enc = b64uEncode(upstream);
    for (const path of [
      `/v1/${TOKEN}`,
      `/v1/${TOKEN}/`,
      `/v1/${TOKEN}/u/${enc}`,
      `/v1/${TOKEN}/u/${enc}/`,
      `/v1/${TOKEN}/u/${enc}/a b`,
      `/v1/${TOKEN}/u/${enc}/x/y`,
      `/v1/${TOKEN}/g/bad-grant/${enc}/x`,
      `/v1/${TOKEN}/g/${enc}/x`,
      `/v1/${TOKEN}/health/${enc}/extra`,
      `/v1/${TOKEN}/u/%41${enc}/x`,
    ]) {
      expect(parseProxyPath(path)).toEqual({ ok: false, error: 'malformed', token: TOKEN });
    }
  });
});
