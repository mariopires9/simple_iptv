// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRange, startTestStreamServer } from './test-stream-server.mjs';

const mp4 = readFileSync(new URL('../fixtures/streams/mp4/h264-aac.mp4', import.meta.url));

describe('test stream server (QA-01 AC2)', () => {
  /** @type {Awaited<ReturnType<typeof startTestStreamServer>>} */
  let corsServer;
  /** @type {Awaited<ReturnType<typeof startTestStreamServer>>} */
  let noCorsServer;

  beforeAll(async () => {
    corsServer = await startTestStreamServer({ port: 0, cors: true, slowBps: 20 * 1024 });
    noCorsServer = await startTestStreamServer({
      port: 0,
      cors: false,
      redirectTo: corsServer.url,
    });
  });
  afterAll(async () => {
    await Promise.all([corsServer?.close(), noCorsServer?.close()]);
  });

  it.each([
    ['/hls/index.m3u8', 'application/vnd.apple.mpegurl'],
    ['/hls/seg00.ts', 'video/mp2t'],
    ['/hls-multi/master.m3u8', 'application/vnd.apple.mpegurl'],
    ['/hls-multi/subs/en.vtt', 'text/vtt; charset=utf-8'],
    ['/ts/h264-ac3.ts', 'video/mp2t'],
    ['/mp4/h264-aac.mp4', 'video/mp4'],
  ])('serves %s as %s', async (path, type) => {
    const res = await fetch(corsServer.url + path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(type);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(res.headers.get('content-length'))).toBe((await res.arrayBuffer()).byteLength);
  });

  it('serves the full MP4 byte-for-byte', async () => {
    const res = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`);
    expect(Buffer.from(await res.arrayBuffer()).equals(mp4)).toBe(true);
  });

  it('answers a Range request with 206 and the exact slice', async () => {
    const res = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, {
      headers: { Range: 'bytes=4-11' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 4-11/${mp4.length}`);
    expect(res.headers.get('content-length')).toBe('8');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString('latin1')).toBe('ftypisom');
  });

  it('supports open-ended and suffix ranges', async () => {
    const open = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, {
      headers: { Range: `bytes=${mp4.length - 10}-` },
    });
    expect(open.status).toBe(206);
    expect(Buffer.from(await open.arrayBuffer()).equals(mp4.subarray(mp4.length - 10))).toBe(true);
    const suffix = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, {
      headers: { Range: 'bytes=-5' },
    });
    expect(suffix.status).toBe(206);
    expect(Buffer.from(await suffix.arrayBuffer()).equals(mp4.subarray(mp4.length - 5))).toBe(true);
  });

  it('answers an unsatisfiable range with 416', async () => {
    const res = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, {
      headers: { Range: `bytes=${mp4.length + 100}-` },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${mp4.length}`);
  });

  it('supports HEAD', async () => {
    const res = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(mp4.length));
  });

  it('sends CORS headers when --cors on and answers preflight', async () => {
    const res = await fetch(`${corsServer.url}/hls/index.m3u8`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-expose-headers')).toContain('Content-Range');
    const pre = await fetch(`${corsServer.url}/hls/index.m3u8`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://app.example.test', 'Access-Control-Request-Headers': 'range' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('Range');
  });

  it('omits CORS headers when --cors off', async () => {
    const res = await fetch(`${noCorsServer.url}/hls/index.m3u8`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('lets /cors/ and /nocors/ override the server default per request', async () => {
    const forcedOn = await fetch(`${noCorsServer.url}/cors/hls/index.m3u8`);
    expect(forcedOn.headers.get('access-control-allow-origin')).toBe('*');
    const forcedOff = await fetch(`${corsServer.url}/nocors/hls/index.m3u8`);
    expect(forcedOff.status).toBe(200);
    expect(forcedOff.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('/redirect/ answers 302 to the same path on the same server by default', async () => {
    const res = await fetch(`${corsServer.url}/redirect/hls/index.m3u8?x=1`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/hls/index.m3u8?x=1');
    const followed = await fetch(`${corsServer.url}/redirect/hls/index.m3u8`);
    expect(followed.status).toBe(200);
    expect(await followed.text()).toContain('#EXTM3U');
  });

  it('/redirect/ answers 302 to another port when --redirect-to is set (keeps other modes)', async () => {
    const res = await fetch(`${noCorsServer.url}/redirect/error500/hls/index.m3u8`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${corsServer.url}/error500/hls/index.m3u8`);
    const followed = await fetch(`${noCorsServer.url}/redirect/hls/index.m3u8`);
    expect(followed.url).toBe(`${corsServer.url}/hls/index.m3u8`);
    expect(followed.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('/error500/ answers 500 (with CORS headers so the browser can read it)', async () => {
    const res = await fetch(`${corsServer.url}/error500/hls/index.m3u8`);
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('/auth401/ answers 401 without a WWW-Authenticate challenge', async () => {
    const res = await fetch(`${corsServer.url}/auth401/ts/h264-aac.ts`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
  });

  it('/slow/ throttles the body but delivers it intact', async () => {
    const t0 = performance.now();
    const res = await fetch(`${corsServer.url}/slow/hls/seg02.ts`); // ~29 KB at 20 KB/s
    const body = Buffer.from(await res.arrayBuffer());
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(
      body.equals(readFileSync(new URL('../fixtures/streams/hls/seg02.ts', import.meta.url))),
    ).toBe(true);
    expect(elapsed).toBeGreaterThan(1000);
  });

  it('/slow/ also honours Range', async () => {
    const res = await fetch(`${corsServer.url}/slow/mp4/h264-aac.mp4`, {
      headers: { Range: 'bytes=0-99' },
    });
    expect(res.status).toBe(206);
    expect(Buffer.from(await res.arrayBuffer()).equals(mp4.subarray(0, 100))).toBe(true);
  });

  it('answers 404 for missing files and refuses path traversal', async () => {
    expect((await fetch(`${corsServer.url}/nope.ts`)).status).toBe(404);
    expect((await fetch(`${corsServer.url}/hls`)).status).toBe(404);
    // The URL parser normalises dot segments, so this stays inside the root.
    expect((await fetch(`${corsServer.url}/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${corsServer.url}/..%2f..%2fpackage.json`)).status).toBe(403);
  });
});

describe('parseRange', () => {
  it.each([
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=90-', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=50-500', 100, { start: 50, end: 99 }],
    ['bytes=-500', 100, { start: 0, end: 99 }],
    [undefined, 100, null],
    ['bytes=0-1,5-6', 100, null],
    ['bytes=100-', 100, 'invalid'],
    ['bytes=9-3', 100, 'invalid'],
    ['bytes=-0', 100, 'invalid'],
    ['bytes=-', 100, 'invalid'],
    ['items=0-1', 100, 'invalid'],
  ])('%s of %d → %o', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});
