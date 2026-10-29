// PRX-01 AC1: the personal proxy URL contract (app side). Synthetic hosts and tokens only.
import { afterEach, describe, expect, it } from 'vitest';
import { clearSecrets, MASK, redact } from '@/core/log';
import { shortenUrl } from './errors';
import type { RequestPurpose } from './http';
import {
  createProxyRewriter,
  encodeBase64Url,
  isValidProxyToken,
  parseProxyBaseUrl,
  parseProxyHealth,
  proxyHealthUrl,
} from './proxy';

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const BASE = 'https://pc.example.test';
const STREAM = 'http://edge.example.test:8080/live/user/pass/101.ts';

/** Decodes unpadded base64url (test oracle, independent from the encoder). */
function decode(b64u: string): string {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

afterEach(() => clearSecrets());

describe('parseProxyBaseUrl', () => {
  it.each([
    ['https://pc.example.test', 'https://pc.example.test'],
    ['  https://pc.example.test/  ', 'https://pc.example.test'],
    ['https://PC.Example.test:8443/', 'https://pc.example.test:8443'],
    ['https://pc.example.test/relay//', 'https://pc.example.test/relay'],
    ['https://pc.example.test/a/b', 'https://pc.example.test/a/b'],
    ['http://localhost:8787', 'http://localhost:8787'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787'],
    ['http://[::1]:8787', 'http://[::1]:8787'],
  ])('accepts %j as %j', (input, expected) => {
    expect(parseProxyBaseUrl(input)).toEqual({ ok: true, baseUrl: expected });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['pc.example.test', 'invalid'],
    ['ftp://pc.example.test', 'invalid'],
    ['javascript:alert(1)', 'invalid'],
    ['http://pc.example.test', 'insecure'],
    ['http://192.168.1.10:8787', 'insecure'],
    ['https://user:secret@pc.example.test', 'credentials'],
    ['https://pc.example.test/?a=1', 'query'],
    ['https://pc.example.test/?', 'query'],
    ['https://pc.example.test/#x', 'query'],
    [`https://pc.example.test/${'a'.repeat(2100)}`, 'too-long'],
  ])('rejects %j (%s)', (input, reason) => {
    expect(parseProxyBaseUrl(input)).toEqual({ ok: false, reason });
  });
});

describe('isValidProxyToken', () => {
  it('accepts 32–128 base64url characters only', () => {
    expect(isValidProxyToken('a'.repeat(32))).toBe(true);
    expect(isValidProxyToken(`${'A-_9'.repeat(32)}`)).toBe(true);
    expect(isValidProxyToken('a'.repeat(31))).toBe(false);
    expect(isValidProxyToken('a'.repeat(129))).toBe(false);
    expect(isValidProxyToken(`${'a'.repeat(31)}=`)).toBe(false);
    expect(isValidProxyToken(`${'a'.repeat(31)}/`)).toBe(false);
  });
});

describe('createProxyRewriter', () => {
  const rewriter = createProxyRewriter({
    baseUrl: BASE,
    token: TOKEN,
    purposes: ['stream', 'playlist'],
  });

  it('rewrites routed purposes to B/v1/<token>/u/<b64u(url)>/<name>', () => {
    const out = rewriter.rewrite(STREAM, 'stream');
    const prefix = `${BASE}/v1/${TOKEN}/u/`;
    expect(out.startsWith(prefix)).toBe(true);
    const [encoded, name, ...rest] = out.slice(prefix.length).split('/');
    expect(rest).toEqual([]);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(encoded ?? '')).toBe(STREAM);
    expect(name).toBe('101.ts');
  });

  it('leaves other purposes unchanged; images are never routed', () => {
    for (const purpose of ['api', 'epg', 'image'] as RequestPurpose[]) {
      expect(rewriter.rewrite(STREAM, purpose)).toBe(STREAM);
    }
    const all = createProxyRewriter({
      baseUrl: BASE,
      token: TOKEN,
      purposes: ['api', 'playlist', 'stream', 'epg', 'image'],
    });
    expect(all.rewrite('https://img.example.test/logo.png', 'image')).toBe(
      'https://img.example.test/logo.png',
    );
    expect(all.rewrite(STREAM, 'api')).not.toBe(STREAM);
  });

  it('is idempotent: a URL already on the proxy (playlist child) is not wrapped twice', () => {
    const once = rewriter.rewrite(STREAM, 'stream');
    expect(rewriter.rewrite(once, 'stream')).toBe(once);
    expect(rewriter.rewrite(once, 'playlist')).toBe(once);
  });

  it('leaves blob:, data: and unparsable URLs untouched', () => {
    for (const url of ['blob:https://app.example.test/1234', 'data:text/plain,hi', 'not a url']) {
      expect(rewriter.rewrite(url, 'stream')).toBe(url);
    }
  });

  it('keeps a base path prefix', () => {
    const prefixed = createProxyRewriter({
      baseUrl: 'https://pc.example.test/relay',
      token: TOKEN,
      purposes: ['playlist'],
    });
    const out = prefixed.rewrite('https://cdn.example.test/hls/index.m3u8?t=1', 'playlist');
    expect(out.startsWith(`https://pc.example.test/relay/v1/${TOKEN}/u/`)).toBe(true);
    expect(out.endsWith('/index.m3u8')).toBe(true);
    expect(prefixed.rewrite(out, 'playlist')).toBe(out);
  });

  it('uses `_` for a last segment that is empty or not safe, and UTF-8 for the target', () => {
    const name = (url: string) => rewriter.rewrite(url, 'stream').split('/').pop();
    expect(name('http://h.example.test/')).toBe('_');
    expect(name('http://h.example.test/a/b%20c.ts')).toBe('_');
    expect(name(`http://h.example.test/${'x'.repeat(65)}`)).toBe('_');
    const unicode = 'http://h.example.test/canal/ç.ts';
    const out = rewriter.rewrite(unicode, 'stream');
    expect(decode(out.split('/').at(-2) ?? '')).toBe(unicode);
  });

  it('leaves a URL longer than 8 KiB unchanged', () => {
    const long = `http://h.example.test/${'a'.repeat(8200)}`;
    expect(rewriter.rewrite(long, 'stream')).toBe(long);
  });

  it('shortenUrl of a proxy URL hides the token and the encoded target', () => {
    const out = rewriter.rewrite(STREAM, 'stream');
    const short = shortenUrl(out) ?? '';
    expect(short).not.toContain(TOKEN);
    expect(short).not.toContain(encodeBase64Url(STREAM));
    expect(short).not.toContain('pc.example.test');
    expect(short).toBe(`https://${MASK}/${MASK}/${MASK}/${MASK}/${MASK}/${MASK}.ts`);
  });

  it('registers the token with the log redactor', () => {
    createProxyRewriter({ baseUrl: BASE, token: TOKEN, purposes: ['stream'] });
    expect(redact(`token=${TOKEN}`)).not.toContain(TOKEN);
  });
});

describe('proxyHealthUrl / parseProxyHealth', () => {
  it('builds the health URL, with an optional probe', () => {
    expect(proxyHealthUrl(BASE, TOKEN)).toBe(`${BASE}/v1/${TOKEN}/health`);
    const probe = proxyHealthUrl(BASE, TOKEN, 'http://panel.example.test:8080/');
    expect(decode(probe.split('/').pop() ?? '')).toBe('http://panel.example.test:8080/');
  });

  it('accepts only this proxy’s answer', () => {
    const ok = { service: 'simple-iptv-proxy', api: 1, activeUpstreams: 2 };
    expect(parseProxyHealth(ok)).toEqual({ activeUpstreams: 2 });
    expect(parseProxyHealth({ ...ok, upstreamAllowed: false })).toEqual({
      activeUpstreams: 2,
      upstreamAllowed: false,
    });
    expect(parseProxyHealth({ ...ok, upstreamAllowed: 'yes' })).toEqual({ activeUpstreams: 2 });
    for (const bad of [
      null,
      [],
      'ok',
      { ...ok, service: 'other' },
      { ...ok, api: 2 },
      { ...ok, activeUpstreams: -1 },
      { ...ok, activeUpstreams: '2' },
      { ...ok, activeUpstreams: 1.5 },
    ]) {
      expect(parseProxyHealth(bad)).toBeUndefined();
    }
  });
});
