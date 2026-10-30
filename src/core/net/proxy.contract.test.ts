// PRX-01: the app's rewriter and the standalone proxy (`proxy/url.ts`) implement the same URL
// contract independently (src may not import proxy/ outside tests). This keeps them in step.
import { describe, expect, it } from 'vitest';
import { buildHealthUrl, buildProxyUrl, parseProxyPath } from '../../../proxy/url.ts';
import { createProxyRewriter, parseProxyBaseUrl, proxyHealthUrl } from './proxy';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456';
const UPSTREAMS = [
  'http://edge.example.test/live/user/pass/123.ts',
  'https://panel.example.test:8443/player_api.php?username=u&password=p&action=get_live_streams',
  'http://edge.example.test/hls/index.m3u8?token=x#frag',
  'http://edge.example.test/dir/',
  'http://edge.example.test/a%20b/caf%C3%A9.m3u8',
  'http://xn--bcher-kva.example.test/ação/ünïcode.ts',
];

function pathOf(proxyUrl: string, base: string): string {
  expect(proxyUrl.startsWith(base)).toBe(true);
  return proxyUrl.slice(base.length);
}

describe('proxy URL contract (app ↔ proxy/url.ts)', () => {
  for (const baseInput of ['https://pc.tail1234.ts.net', 'https://pc.tail1234.ts.net/iptv/']) {
    const parsed = parseProxyBaseUrl(baseInput);
    if (!parsed.ok) throw new Error('fixture base must parse');
    const base = parsed.baseUrl;
    const rewriter = createProxyRewriter({ baseUrl: base, token: TOKEN, purposes: ['stream'] });

    it.each(UPSTREAMS)(`the proxy decodes what the app builds (${baseInput}): %s`, (upstream) => {
      const route = parseProxyPath(pathOf(rewriter.rewrite(upstream, 'stream'), base));
      expect(route).toEqual({ ok: true, token: TOKEN, route: { kind: 'u', target: upstream } });
    });

    it.each(UPSTREAMS)(
      `the app leaves proxy-built child URLs alone (${baseInput}): %s`,
      (upstream) => {
        const child = buildProxyUrl(base, TOKEN, upstream, '1a2b3c.ABCDEFGHIJKLMNOPQRSTUV');
        expect(rewriter.rewrite(child, 'stream')).toBe(child);
      },
    );

    it(`both sides build the same health URLs (${baseInput})`, () => {
      expect(proxyHealthUrl(base, TOKEN)).toBe(buildHealthUrl(base, TOKEN));
      const probe = 'https://panel.example.test/';
      expect(proxyHealthUrl(base, TOKEN, probe)).toBe(buildHealthUrl(base, TOKEN, probe));
      expect(parseProxyPath(pathOf(proxyHealthUrl(base, TOKEN, probe), base))).toEqual({
        ok: true,
        token: TOKEN,
        route: { kind: 'health', target: probe },
      });
    });
  }
});
