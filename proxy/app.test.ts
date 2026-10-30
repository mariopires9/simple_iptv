// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_HEADER } from './cors.ts';
import {
  TEST_ORIGIN,
  TEST_TOKEN,
  delay,
  fakeResolver,
  fetchRaw,
  openRaw,
  rawRequest,
  startProxy,
  startUpstream,
  testConfig,
  waitFor,
} from './test-support.ts';
import { b64uDecode, b64uEncode, buildHealthUrl, buildProxyUrl, parseProxyPath } from './url.ts';

type Proxy = Awaited<ReturnType<typeof startProxy>>;
type Upstream = Awaited<ReturnType<typeof startUpstream>>;

// Log spy over the whole suite: nothing the proxy prints may contain a host, path, query, token
// or encoded URL (PRX-01 AC2 "no URL logging").
const logged: string[] = [];
const consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  }),
);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});
afterAll(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

async function proxyWith(...args: Parameters<typeof startProxy>): Promise<Proxy> {
  const proxy = await startProxy(...args);
  cleanups.push(proxy.close);
  return proxy;
}
async function upstreamWith(handler: Parameters<typeof startUpstream>[0]): Promise<Upstream> {
  const upstream = await startUpstream(handler);
  cleanups.push(upstream.close);
  return upstream;
}

const u = (proxy: Proxy, upstreamUrl: string, token = TEST_TOKEN) =>
  buildProxyUrl(proxy.url, token, upstreamUrl);

/** Upstream answering every request with `body` (and recording request headers). */
const textUpstream = (body: string | Buffer, headers: Record<string, string> = {}) =>
  upstreamWith((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...headers });
    res.end(body);
  });

describe('token and health (PRX-01)', () => {
  it('answers health with the documented JSON shape', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(res.body.toString())).toEqual({
      service: 'simple-iptv-proxy',
      api: 1,
      activeUpstreams: 0,
    });
  });

  it('reports upstreamAllowed from the allowlist only (no DNS)', async () => {
    const calls: string[] = [];
    const proxy = await proxyWith(testConfig(), { resolve: fakeResolver(calls) });
    const allowed = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN, 'http://upstream.test/x'));
    const denied = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN, 'http://elsewhere.test/'));
    expect(JSON.parse(allowed.body.toString()).upstreamAllowed).toBe(true);
    expect(JSON.parse(denied.body.toString()).upstreamAllowed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses a wrong or missing token with 401 and an empty body', async () => {
    const proxy = await proxyWith();
    const wrong = await fetchRaw(buildHealthUrl(proxy.url, 'x'.repeat(43)));
    const missing = await fetchRaw(`${proxy.url}/v1//health`);
    for (const res of [wrong, missing]) {
      expect(res.status).toBe(401);
      expect(res.body.length).toBe(0);
      expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('bad-token');
    }
  });

  it('ignores a token passed in the query string', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(`${proxy.url}/v1/health?token=${TEST_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it('answers 404 outside /v1/ and for absolute-form (forward proxy) targets', async () => {
    const proxy = await proxyWith();
    expect((await fetchRaw(`${proxy.url}/`)).status).toBe(404);
    expect((await fetchRaw(`${proxy.url}/v2/${TEST_TOKEN}/health`)).status).toBe(404);
    // A raw absolute-form request line, as a forward-proxy client would send.
    const absolute = await rawRequest(
      proxy.port,
      'GET http://upstream.test/ HTTP/1.1\r\nHost: upstream.test\r\nConnection: close\r\n\r\n',
    );
    expect(absolute.startsWith('HTTP/1.1 404 ')).toBe(true);
  });

  it('refuses CONNECT tunnels', async () => {
    const proxy = await proxyWith();
    const reply = await rawRequest(
      proxy.port,
      'CONNECT upstream.test:443 HTTP/1.1\r\nHost: upstream.test:443\r\n\r\n',
    );
    expect(reply.startsWith('HTTP/1.1 405 ')).toBe(true);
  });

  it('locks every request out for 60 s after too many bad tokens', async () => {
    let clock = 1_000_000;
    const proxy = await proxyWith(testConfig({ limits: { badTokenPerMinute: 3 } }), {
      now: () => clock,
    });
    for (let i = 0; i < 3; i++) {
      expect((await fetchRaw(buildHealthUrl(proxy.url, 'y'.repeat(40)))).status).toBe(401);
    }
    const locked = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN));
    expect(locked.status).toBe(429);
    expect(locked.headers[ERROR_HEADER.toLowerCase()]).toBe('rate-limited');
    clock += 61_000;
    expect((await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN))).status).toBe(200);
  });

  it('answers 429 above requestsPerMinute', async () => {
    const proxy = await proxyWith(testConfig({ limits: { requestsPerMinute: 2 } }), {
      now: () => 5_000_000,
    });
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN))).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('methods and CORS', () => {
  it('refuses other methods with 405', async () => {
    const proxy = await proxyWith();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN), { method });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD, OPTIONS');
    }
  });

  it('answers an allowed preflight with 204 and the Private Network Access header', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, 'http://upstream.test/a.ts'), {
      method: 'OPTIONS',
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'range',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toBe('GET, HEAD');
    expect(res.headers['access-control-allow-headers']).toBe('Range');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    expect(res.headers.vary).toBe('Origin');
  });

  it('refuses a foreign Origin with 403 and no CORS grant', async () => {
    const proxy = await proxyWith();
    for (const method of ['GET', 'OPTIONS']) {
      const res = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN), {
        method,
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('origin-not-allowed');
    }
  });

  it('serves requests without Origin (video element) and grants exact CORS to allowed origins', async () => {
    const proxy = await proxyWith();
    const plain = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN));
    expect(plain.status).toBe(200);
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    const cors = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN), {
      headers: { Origin: TEST_ORIGIN },
    });
    expect(cors.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(cors.headers['access-control-expose-headers']).toBe(
      'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Simple-Iptv-Proxy-Error',
    );
  });
});

describe('upstream allowlist and request validation', () => {
  it('relays exact and wildcard hosts (case-insensitive) and refuses others', async () => {
    const upstream = await textUpstream('hello');
    const proxy = await proxyWith();
    const at = (host: string) => `http://${host}:${upstream.port}/file.txt`;
    expect((await fetchRaw(u(proxy, at('upstream.test')))).body.toString()).toBe('hello');
    expect((await fetchRaw(u(proxy, at('UPSTREAM.test')))).status).toBe(200);
    expect((await fetchRaw(u(proxy, at('a.edge.test')))).status).toBe(200);
    expect((await fetchRaw(u(proxy, at('deep.a.edge.test')))).status).toBe(200);
    for (const host of ['edge.test', 'other.test']) {
      const res = await fetchRaw(u(proxy, at(host)));
      expect(res.status).toBe(403);
      expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('host-not-allowed');
    }
    expect(upstream.requests).toHaveLength(4);
  });

  it('without an allowlist relays any public host; the address policy still applies (PRX-02)', async () => {
    const upstream = await textUpstream('hello');
    const proxy = await proxyWith(testConfig({ upstream: { allowedHosts: null } }));
    const res = await fetchRaw(u(proxy, `http://other.test:${upstream.port}/file.txt`));
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('hello');
    for (const host of ['private.test', 'metadata.test', 'cgnat.test', '192.168.1.1']) {
      const refused = await fetchRaw(u(proxy, `http://${host}/a.ts`));
      expect(refused.status).toBe(403);
      expect(refused.headers[ERROR_HEADER.toLowerCase()]).toBe('address-blocked');
    }
    const health = await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN, 'http://any.example/'));
    expect(JSON.parse(health.body.toString()).upstreamAllowed).toBe(true);
  });

  it.each([
    ['bad base64', (p: Proxy) => `${p.url}/v1/${TEST_TOKEN}/u/not*b64/x.ts`],
    [
      'padding',
      (p: Proxy) => `${p.url}/v1/${TEST_TOKEN}/u/${b64uEncode('http://upstream.test/a')}==/a`,
    ],
    [
      'missing name',
      (p: Proxy) => `${p.url}/v1/${TEST_TOKEN}/u/${b64uEncode('http://upstream.test/a')}`,
    ],
    [
      'extra segment',
      (p: Proxy) => `${p.url}/v1/${TEST_TOKEN}/u/${b64uEncode('http://upstream.test/a')}/a/b`,
    ],
    [
      'unknown kind',
      (p: Proxy) => `${p.url}/v1/${TEST_TOKEN}/x/${b64uEncode('http://upstream.test/a')}/a`,
    ],
  ])('answers 400 for a malformed path (%s)', async (_label, build) => {
    const proxy = await proxyWith();
    const res = await fetchRaw(build(proxy));
    expect(res.status).toBe(400);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('malformed');
  });

  it.each([
    ['ftp scheme', 'ftp://upstream.test/a'],
    ['file scheme', 'file:///etc/passwd'],
    ['userinfo', 'http://user:pass@upstream.test/a'],
    ['relative', '/live/1.ts'],
  ])('answers 400 for a bad upstream URL (%s)', async (_label, target) => {
    const proxy = await proxyWith();
    const res = await fetchRaw(`${proxy.url}/v1/${TEST_TOKEN}/u/${b64uEncode(target)}/a`);
    expect(res.status).toBe(400);
  });

  it('answers 400 for an upstream URL over 8 KiB', async () => {
    const proxy = await proxyWith();
    const long = `http://upstream.test/${'a'.repeat(8200)}`;
    const res = await fetchRaw(`${proxy.url}/v1/${TEST_TOKEN}/u/${b64uEncode(long)}/a`);
    expect(res.status).toBe(400);
  });

  it('answers 401 before 400 when the token is wrong', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(`${proxy.url}/v1/${'z'.repeat(40)}/u/garbage`);
    expect(res.status).toBe(401);
  });
});

describe('SSRF address policy', () => {
  it.each([
    ['private DNS answer', 'private.test'],
    ['cloud metadata', 'metadata.test'],
    ['mixed public/private answers', 'mixed.test'],
    ['CGNAT/Tailscale range', 'cgnat.test'],
    ['IPv6 ULA (Tailscale)', 'v6private.test'],
    ['IPv4-mapped private', 'mapped.test'],
    ['private IPv4 literal', '192.168.1.1'],
    ['IPv6 loopback literal', '[::1]'],
  ])('refuses %s with 403', async (_label, host) => {
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://${host}/a.ts`));
    expect(res.status).toBe(403);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('address-blocked');
  });

  it('answers 502 when the host does not resolve', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, 'http://nxdomain.test/a.ts'));
    expect(res.status).toBe(502);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('upstream-unreachable');
  });

  it('resolves once per hop and connects to the vetted address (no re-resolution)', async () => {
    const upstream = await textUpstream('pinned');
    const calls: string[] = [];
    const proxy = await proxyWith(testConfig(), { resolve: fakeResolver(calls) });
    // `upstream.test` does not exist in real DNS: the request only works if the socket used the
    // address vetted by the proxy instead of resolving the name again.
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/x`));
    expect(res.body.toString()).toBe('pinned');
    expect(calls).toEqual(['upstream.test']);
  });
});

describe('redirects', () => {
  it('follows a cross-host redirect to a non-allowlisted http host, never forwarding it', async () => {
    const target = await textUpstream('final body');
    const origin = await upstreamWith((_req, res) => {
      res.writeHead(302, { Location: `http://other.test:${target.port}/edge/stream.ts?t=1` }).end();
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${origin.port}/live/1.ts`));
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body.toString()).toBe('final body');
    expect(target.requests[0]?.url).toBe('/edge/stream.ts?t=1');
  });

  it('resolves a relative Location and follows 301/303/307/308', async () => {
    let hops = 0;
    const codes = [301, 303, 307, 308];
    const upstream = await upstreamWith((req, res) => {
      if (req.url?.startsWith('/end')) {
        res.writeHead(200).end(`done ${req.method}`);
        return;
      }
      const code = codes[hops++] ?? 302;
      res.writeHead(code, { Location: hops < codes.length ? `/hop${hops}` : '../end' }).end();
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/start`));
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('done GET');
    expect(upstream.requests.map((r) => r.url)).toEqual([
      '/start',
      '/hop1',
      '/hop2',
      '/hop3',
      '/end',
    ]);
  });

  it('refuses a redirect to a private address (403) or a non-http scheme (502)', async () => {
    const upstream = await upstreamWith((req, res) => {
      const location = req.url === '/private' ? 'http://10.0.0.1/admin' : 'file:///etc/passwd';
      res.writeHead(302, { Location: location }).end();
    });
    const proxy = await proxyWith();
    const priv = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/private`));
    expect(priv.status).toBe(403);
    expect(priv.headers[ERROR_HEADER.toLowerCase()]).toBe('address-blocked');
    const scheme = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/scheme`));
    expect(scheme.status).toBe(502);
    expect(scheme.headers[ERROR_HEADER.toLowerCase()]).toBe('bad-redirect');
  });

  it('answers 502 after more than 5 redirects', async () => {
    const upstream = await upstreamWith((req, res) => {
      const n = Number(req.url?.slice(1) ?? '0');
      res.writeHead(302, { Location: `/${n + 1}` }).end();
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/0`));
    expect(res.status).toBe(502);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('too-many-redirects');
    expect(upstream.requests).toHaveLength(6);
  });
});

/** Extracts the proxy URLs written into a rewritten playlist. */
const proxyUrlsIn = (playlist: string, base: string) =>
  [...playlist.matchAll(/http:\/\/127\.0\.0\.1:\d+\/v1\/[^\s"]+/g)]
    .map((m) => m[0])
    .filter((x) => x.startsWith(base));

const upstreamOf = (proxyUrl: string, base: string) => {
  const parsed = parseProxyPath(proxyUrl.slice(base.length));
  if (!parsed.ok) throw new Error('not a proxy URL');
  return 'target' in parsed.route ? parsed.route.target : undefined;
};

describe('HLS playlists and grants', () => {
  let streams: { url: string; port: number; close(): Promise<void> };
  let redirecting: { url: string; port: number; close(): Promise<void> };

  beforeAll(async () => {
    const mod = (await import('../scripts/test-stream-server.mjs' as string)) as {
      startTestStreamServer(options: Record<string, unknown>): Promise<typeof streams>;
    };
    streams = await mod.startTestStreamServer({ port: 0 });
    // A second server whose /redirect/ prefix 302s to a different host name (`a.edge.test`).
    redirecting = await mod.startTestStreamServer({
      port: 0,
      redirectTo: `http://a.edge.test:${streams.port}`,
    });
  });
  afterAll(async () => {
    await Promise.all([streams.close(), redirecting.close()]);
  });

  it('rewrites a media playlist into absolute g URLs that play through the proxy', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${streams.port}/hls/index.m3u8`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    const text = res.body.toString();
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
    expect(text).toContain('#EXT-X-TARGETDURATION:2');
    const urls = proxyUrlsIn(text, proxy.url);
    expect(urls).toHaveLength(3);
    expect(urls.every((x) => x.includes('/g/') && x.endsWith('.ts'))).toBe(true);
    expect(upstreamOf(urls[0] ?? '', proxy.url)).toBe(
      `http://upstream.test:${streams.port}/hls/seg00.ts`,
    );
    const segment = await fetchRaw(urls[0] ?? '');
    expect(segment.status).toBe(200);
    expect(
      segment.body.equals(
        readFileSync(new URL('../fixtures/streams/hls/seg00.ts', import.meta.url)),
      ),
    ).toBe(true);
  });

  it('resolves URIs against the final post-redirect URL (master playlist, MEDIA URIs)', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(
      u(proxy, `http://upstream.test:${redirecting.port}/redirect/hls-multi/master.m3u8`),
    );
    expect(res.status).toBe(200);
    const targets = proxyUrlsIn(res.body.toString(), proxy.url).map((x) =>
      upstreamOf(x, proxy.url),
    );
    expect(targets).toEqual([
      `http://a.edge.test:${streams.port}/hls-multi/audio_en.m3u8`,
      `http://a.edge.test:${streams.port}/hls-multi/audio_pt.m3u8`,
      `http://a.edge.test:${streams.port}/hls-multi/subs/en.m3u8`,
      `http://a.edge.test:${streams.port}/hls-multi/video.m3u8`,
    ]);
    // Nested playlists are rewritten too, with their own grants.
    const video = await fetchRaw(proxyUrlsIn(res.body.toString(), proxy.url).at(-1) ?? '');
    expect(proxyUrlsIn(video.body.toString(), proxy.url)).toHaveLength(3);
  });

  it('builds playlist URLs on the public base seen through Tailscale Serve', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${streams.port}/hls/index.m3u8`), {
      headers: { Host: 'mypc.tailnet-name.ts.net', 'X-Forwarded-Proto': 'https' },
    });
    expect(res.body.toString()).toMatch(/^https:\/\/mypc\.tailnet-name\.ts\.net\/v1\/[^/]+\/g\//m);
  });

  it('uses publicBaseUrl when configured', async () => {
    const proxy = await proxyWith(testConfig({ publicBaseUrl: 'https://pc.example.ts.net/iptv/' }));
    const res = await fetchRaw(u(proxy, `http://upstream.test:${streams.port}/hls/index.m3u8`));
    expect(res.body.toString()).toMatch(/^https:\/\/pc\.example\.ts\.net\/iptv\/v1\/[^/]+\/g\//m);
  });

  const TAGGED = [
    '\ufeff#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm-key-id",KEYFORMAT="com.apple.streamingkeydelivery"',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="iframes.m3u8"',
    '#EXT-X-PART:DURATION=1,URI="part1.m4s"',
    '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part2.m4s"',
    '#EXT-X-RENDITION-REPORT:URI="../alt/index.m3u8",LAST-MSN=1',
    '#EXTINF:2,',
    'https://cdn.example.org/abs.ts',
    '#EXTINF:2,',
    '  seg1.ts  ',
    '',
  ].join('\r\n');

  it('rewrites KEY/MAP/I-FRAME/PART/PRELOAD-HINT/RENDITION-REPORT URIs, keeps skd:/data:, CRLF and BOM', async () => {
    const upstream = await textUpstream(TAGGED, {
      'Content-Type': 'application/vnd.apple.mpegurl',
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/live/x/index.m3u8`));
    const text = res.body.toString();
    expect(text.startsWith('\ufeff#EXTM3U\r\n')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(TAGGED.split('\r\n').length);
    expect(text).toContain('URI="skd://drm-key-id"');
    expect(text).toContain('URI="data:text/plain;base64,AAAA"');
    const targets = proxyUrlsIn(text, proxy.url).map((x) => upstreamOf(x, proxy.url));
    const base = `http://upstream.test:${upstream.port}/live`;
    expect(targets).toEqual([
      `${base}/x/key.bin`,
      `${base}/x/init.mp4`,
      `${base}/x/iframes.m3u8`,
      `${base}/x/part1.m4s`,
      `${base}/x/part2.m4s`,
      `${base}/alt/index.m3u8`,
      'https://cdn.example.org/abs.ts',
      `${base}/x/seg1.ts`,
    ]);
    expect(text).toMatch(/\r\n {2}http:\/\/127\.0\.0\.1:\d+\/v1\/.+\/seg1\.ts {2}\r\n/);
  });

  it('decodes a gzip playlist before rewriting', async () => {
    const upstream = await upstreamWith((req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/x-mpegurl' });
      res.end(gzipSync(Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg.ts\n')));
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/p.m3u8`), {
      headers: { 'Accept-Encoding': 'gzip, zstd' },
    });
    expect(upstream.requests[0]?.headers['accept-encoding']).toBe('gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(proxyUrlsIn(res.body.toString(), proxy.url)).toHaveLength(1);
  });

  it('answers 502 for a playlist over playlistMaxBytes', async () => {
    const big = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${'#EXTINF:4,\nsegment.ts\n'.repeat(400)}`;
    const upstream = await textUpstream(big);
    const proxy = await proxyWith(testConfig({ limits: { playlistMaxBytes: 2048 } }));
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/big.m3u8`));
    expect(res.status).toBe(502);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('playlist-too-large');
  });

  it('passes an IPTV M3U channel list byte-identical, and streams it before it ends', async () => {
    const entry = (i: number) =>
      `#EXTINF:-1 tvg-id="c${i}" group-title="News",Channel ${i}\nhttp://upstream.test/live/u/p/${i}.ts\n`;
    const head = Buffer.from(
      `#EXTM3U x-tvg-url="http://upstream.test/epg.xml"\r\n${Array.from({ length: 1500 }, (_, i) => entry(i)).join('')}`,
    );
    const tail = Buffer.from(entry(99999));
    let release: () => void = () => {};
    const upstream = await upstreamWith((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      res.write(head);
      release = () => res.end(tail);
    });
    expect(head.length).toBeGreaterThan(64 * 1024);
    const proxy = await proxyWith();
    const { res } = await openRaw(u(proxy, `http://upstream.test:${upstream.port}/get.php`));
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    // Data arrives while the upstream is still holding the end of the list.
    expect(await waitFor(() => chunks.reduce((n, c) => n + c.length, 0) >= head.length)).toBe(true);
    release();
    await new Promise((resolve) => res.on('end', resolve));
    expect(Buffer.concat(chunks).equals(Buffer.concat([head, tail]))).toBe(true);
    expect(res.headers['content-type']).toBe('audio/x-mpegurl');
  });

  it('refuses tampered, expired, wrong-URL and pre-rotation grants with 403', async () => {
    let clock = Date.now();
    const config = testConfig();
    const proxy = await proxyWith(config, { now: () => clock });
    const playlist = await fetchRaw(
      u(proxy, `http://upstream.test:${streams.port}/hls/index.m3u8`),
    );
    const [first = '', second = ''] = proxyUrlsIn(playlist.body.toString(), proxy.url);
    expect((await fetchRaw(first)).status).toBe(200);

    const parts = first.split('/');
    const grantAt = parts.indexOf('g') + 1;
    const tampered = [...parts];
    const grant = tampered[grantAt] ?? '';
    tampered[grantAt] = grant.slice(0, -1) + (grant.endsWith('A') ? 'B' : 'A');
    const wrongUrl = [...parts];
    wrongUrl[grantAt + 1] = second.split('/')[grantAt + 1] ?? '';
    for (const url of [tampered.join('/'), wrongUrl.join('/')]) {
      const res = await fetchRaw(url);
      expect(res.status).toBe(403);
      expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('bad-grant');
    }

    // Token rotation: a proxy with a new token rejects grants issued under the old one.
    const rotatedToken = 'rotated-token-0123456789-abcdefghijklmn';
    const rotated = await proxyWith(testConfig({ token: rotatedToken }), { now: () => clock });
    const reissued = first.replace(proxy.url, rotated.url).replace(TEST_TOKEN, rotatedToken);
    expect((await fetchRaw(reissued)).status).toBe(403);

    clock += 24 * 3600 * 1000 + 1000;
    expect((await fetchRaw(first)).status).toBe(403);
  });

  it('keeps the decoded URL inside the grant check (b64 decode is canonical)', () => {
    const encoded = b64uEncode('http://upstream.test/a.ts');
    expect(b64uDecode(encoded)).toBe('http://upstream.test/a.ts');
  });
});

describe('streaming, ranges and connection handling', () => {
  it('sends the first chunk before the upstream finishes', async () => {
    let finish: () => void = () => {};
    const upstream = await upstreamWith((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(Buffer.alloc(188, 0x47));
      finish = () => res.end();
    });
    const proxy = await proxyWith();
    const { res } = await openRaw(u(proxy, `http://upstream.test:${upstream.port}/live/1.ts`));
    const first = await new Promise<Buffer>((resolve) => res.once('data', resolve));
    expect(first[0]).toBe(0x47);
    finish();
    res.resume();
  });

  it('bounds upstream reads while the client is paused (backpressure)', async () => {
    let written = 0;
    const upstream = await upstreamWith((_req, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      const chunk = Buffer.alloc(64 * 1024, 0x47);
      const pump = () => {
        while (written < 256 * 1024 * 1024) {
          written += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    const proxy = await proxyWith();
    const { req, res } = await openRaw(
      u(proxy, `http://upstream.test:${upstream.port}/vod/big.ts`),
    );
    res.pause();
    await delay(500);
    const afterPause = written;
    await delay(300);
    // Only socket/stream buffers fill up; the upstream stops being read.
    expect(written).toBeLessThan(64 * 1024 * 1024);
    expect(written - afterPause).toBeLessThan(4 * 1024 * 1024);
    req.destroy();
  });

  it('closes the upstream within 1 s when the client aborts, and activeUpstreams returns to 0', async () => {
    let upstreamClosed = false;
    const upstream = await upstreamWith((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      const timer = setInterval(() => res.write(Buffer.alloc(188, 0x47)), 20);
      res.on('close', () => {
        clearInterval(timer);
        upstreamClosed = true;
      });
    });
    const proxy = await proxyWith();
    const { req, res } = await openRaw(u(proxy, `http://upstream.test:${upstream.port}/live/2.ts`));
    await new Promise((resolve) => res.once('data', resolve));
    expect(proxy.proxy.activeUpstreams()).toBe(1);
    const health = JSON.parse(
      (await fetchRaw(buildHealthUrl(proxy.url, TEST_TOKEN))).body.toString(),
    );
    expect(health.activeUpstreams).toBe(1);
    req.destroy();
    expect(await waitFor(() => upstreamClosed, 1000)).toBe(true);
    expect(await waitFor(() => proxy.proxy.activeUpstreams() === 0, 1000)).toBe(true);
  });

  it('aborts a pending redirect chain when the client leaves', async () => {
    let secondHop = 0;
    const upstream = await upstreamWith((req, res) => {
      if (req.url === '/slow-redirect') {
        setTimeout(() => res.writeHead(302, { Location: '/target' }).end(), 300);
        return;
      }
      secondHop++;
      res.end('x');
    });
    const proxy = await proxyWith();
    const pending = openRaw(u(proxy, `http://upstream.test:${upstream.port}/slow-redirect`)).catch(
      () => null,
    );
    await delay(100);
    // Destroy every client socket to the proxy (the pending request among them).
    proxy.proxy.server.closeAllConnections();
    await pending;
    await delay(400);
    expect(secondHop).toBe(0);
    expect(proxy.proxy.activeUpstreams()).toBe(0);
  });

  it('forwards Range/If-Range and passes a 206 through; HEAD has no body', async () => {
    const streams = await (
      (await import('../scripts/test-stream-server.mjs' as string)) as {
        startTestStreamServer(
          o: Record<string, unknown>,
        ): Promise<{ port: number; close(): Promise<void> }>;
      }
    ).startTestStreamServer({ port: 0 });
    cleanups.push(streams.close);
    const proxy = await proxyWith();
    const url = u(proxy, `http://upstream.test:${streams.port}/mp4/h264-aac.mp4`);
    const ranged = await fetchRaw(url, { headers: { Range: 'bytes=0-99', 'If-Range': '"x"' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect(ranged.headers['accept-ranges']).toBe('bytes');
    expect(ranged.body.length).toBe(100);
    const head = await fetchRaw(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(1000);
    expect(head.body.length).toBe(0);
  });

  it('passes If-Range upstream and drops Range for playlists', async () => {
    const upstream = await textUpstream('payload');
    const proxy = await proxyWith();
    await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/movie.mkv`), {
      headers: { Range: 'bytes=5-', 'If-Range': '"etag-1"' },
    });
    await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/index.m3u8`), {
      headers: { Range: 'bytes=5-' },
    });
    expect(upstream.requests[0]?.headers.range).toBe('bytes=5-');
    expect(upstream.requests[0]?.headers['if-range']).toBe('"etag-1"');
    expect(upstream.requests[1]?.headers.range).toBeUndefined();
  });

  it('passes upstream error statuses through', async () => {
    const upstream = await upstreamWith((_req, res) =>
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('nope'),
    );
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/missing.ts`));
    expect(res.status).toBe(404);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('answers 504 when the upstream sends no headers in time', async () => {
    const upstream = await upstreamWith(() => {
      /* never answers */
    });
    const proxy = await proxyWith(testConfig({ upstream: { headersTimeoutMs: 1000 } }));
    const started = Date.now();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/hang.ts`));
    expect(res.status).toBe(504);
    expect(res.headers[ERROR_HEADER.toLowerCase()]).toBe('upstream-timeout');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('answers 429 above maxConcurrentUpstreams', async () => {
    const upstream = await upstreamWith((_req, res) => {
      res.writeHead(200);
      res.write('x');
    });
    const proxy = await proxyWith(testConfig({ limits: { maxConcurrentUpstreams: 1 } }));
    const first = await openRaw(u(proxy, `http://upstream.test:${upstream.port}/a.ts`));
    const second = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/b.ts`));
    expect(second.status).toBe(429);
    expect(second.headers[ERROR_HEADER.toLowerCase()]).toBe('too-many-upstreams');
    first.req.destroy();
  });
});

describe('header hygiene', () => {
  it('forwards only Range, If-Range, Accept, Accept-Encoding and User-Agent upstream', async () => {
    const upstream = await upstreamWith((_req, res) => {
      res.writeHead(200, {
        'Set-Cookie': 'session=1',
        'Content-Type': 'video/mp2t',
        'X-Upstream': 'leak',
      });
      res.end('ok');
    });
    const proxy = await proxyWith();
    const res = await fetchRaw(u(proxy, `http://upstream.test:${upstream.port}/s.ts`), {
      headers: {
        Origin: TEST_ORIGIN,
        Cookie: 'a=b',
        Authorization: 'Basic eDp5',
        Referer: 'https://app.example/#/live',
        'X-Forwarded-For': '100.64.0.2',
        'X-Forwarded-Proto': 'https',
        'Tailscale-User-Login': 'owner@example.com',
        'User-Agent': 'TestAgent/1.0',
        Accept: '*/*',
      },
    });
    const sent = upstream.requests[0]?.headers ?? {};
    for (const name of [
      'cookie',
      'authorization',
      'referer',
      'origin',
      'x-forwarded-for',
      'x-forwarded-proto',
      'tailscale-user-login',
    ]) {
      expect(sent[name]).toBeUndefined();
    }
    expect(sent['user-agent']).toBe('TestAgent/1.0');
    expect(sent.accept).toBe('*/*');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-upstream']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res.headers['x-content-type-options']).toBeUndefined();
    expect(res.headers['content-type']).toBe('video/mp2t');
  });

  it('adds the security headers to refusals too', async () => {
    const proxy = await proxyWith();
    const res = await fetchRaw(buildHealthUrl(proxy.url, 'w'.repeat(40)));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  });
});

describe('logging privacy (runs last)', () => {
  it('never printed a host, path, query, token, grant or encoded URL', () => {
    expect(logged.length).toBeGreaterThan(20);
    const forbidden = [
      TEST_TOKEN,
      'upstream.test',
      'edge.test',
      'other.test',
      '/v1/',
      '.ts',
      '.m3u8',
      'get.php',
      '?',
      b64uEncode('http://upstream.test').slice(0, 12),
    ];
    for (const line of logged) {
      for (const needle of forbidden) expect(line).not.toContain(needle);
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(entry)) {
        expect(['time', 'event', 'status', 'code', 'durationMs', 'bytes']).toContain(key);
      }
    }
  });
});
