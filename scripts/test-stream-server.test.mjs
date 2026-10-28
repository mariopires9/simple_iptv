// @vitest-environment node
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseRange, splitRequestTarget, startTestStreamServer } from './test-stream-server.mjs';

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
    // fetch's URL parser normalises dot segments client-side, so this stays inside the root.
    expect((await fetch(`${corsServer.url}/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${corsServer.url}/..%2f..%2fpackage.json`)).status).toBe(403);
    // Raw, un-normalised targets sent on the wire.
    expect((await rawGet(corsServer.port, '/../../package.json')).status).toBe(403);
    expect((await rawGet(corsServer.port, '/%2e%2e/%2e%2e/package.json')).status).toBe(403);
  });

  // Review finding 1: `//x/...` must be a path, not a URL authority.
  it('treats a leading double slash as part of the path', async () => {
    const res = await rawGet(corsServer.port, '//hls/index.m3u8');
    expect(res.status).toBe(200);
    expect(res.body).toContain('#EXTM3U');
    const prefixed = await rawGet(corsServer.port, '//cors//hls//index.m3u8?x=1');
    expect(prefixed.status).toBe(200);
    expect(prefixed.headers['access-control-allow-origin']).toBe('*');
  });

  // Review finding 5: malformed headers / unknown units are ignored (200 full body).
  it.each(['items=0-1', 'bytes=9-3', 'bytes=-', 'bytes=abc', 'bytes=0-1,5-6'])(
    'ignores the Range header %s and serves 200 with the full body',
    async (range) => {
      const res = await fetch(`${corsServer.url}/mp4/h264-aac.mp4`, { headers: { Range: range } });
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).equals(mp4)).toBe(true);
    },
  );
});

/** GET with the request target sent verbatim (no client-side URL normalisation). */
function rawGet(port, target) {
  return new Promise((resolveGet, rejectGet) => {
    const req = request({ host: '127.0.0.1', port, path: target, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('latin1');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolveGet({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', rejectGet);
    req.end();
  });
}

describe('startTestStreamServer options', () => {
  // Review finding 2: redirectTo is normalised by the API, not only by the CLI parser.
  it('strips trailing slashes from redirectTo', async () => {
    const s = await startTestStreamServer({ redirectTo: 'http://127.0.0.1:9/base//' });
    try {
      const res = await fetch(`${s.url}/redirect/hls/index.m3u8`, { redirect: 'manual' });
      expect(res.headers.get('location')).toBe('http://127.0.0.1:9/base/hls/index.m3u8');
    } finally {
      await s.close();
    }
  });

  // Review finding 6: no stale reject listener; runtime errors are logged, not thrown.
  it('replaces the startup error listener with a persistent logger', async () => {
    const s = await startTestStreamServer();
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(s.server.listenerCount('error')).toBe(1);
      expect(() => s.server.emit('error', new Error('boom'))).not.toThrow();
      expect(write).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect((await fetch(`${s.url}/hls/index.m3u8`)).status).toBe(200);
    } finally {
      write.mockRestore();
      await s.close();
    }
  });

  it('rejects when the port is already in use', async () => {
    const a = await startTestStreamServer();
    try {
      await expect(startTestStreamServer({ port: a.port })).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await a.close();
    }
  });
});

describe('parseRange (RFC 9110)', () => {
  it.each([
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=90-', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=50-500', 100, { start: 50, end: 99 }],
    ['bytes=-500', 100, { start: 0, end: 99 }],
    ['BYTES=0-0', 100, { start: 0, end: 0 }],
    [undefined, 100, null],
    // Ignored (serve 200): multi-range, malformed syntax, unknown unit.
    ['bytes=0-1,5-6', 100, null],
    ['bytes=9-3', 100, null],
    ['bytes=-', 100, null],
    ['bytes=abc', 100, null],
    ['items=0-1', 100, null],
    // Valid syntax but unsatisfiable (416).
    ['bytes=100-', 100, 'unsatisfiable'],
    ['bytes=-0', 100, 'unsatisfiable'],
    ['bytes=0-', 0, 'unsatisfiable'],
  ])('%s of %d → %o', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});

describe('splitRequestTarget', () => {
  it.each([
    ['/hls/index.m3u8', ['hls', 'index.m3u8'], ''],
    ['//hls/index.m3u8?a=1', ['hls', 'index.m3u8'], '?a=1'],
    ['//evil.example.test/x', ['evil.example.test', 'x'], ''],
    ['/', [], ''],
  ])('%s', (target, segments, search) => {
    expect(splitRequestTarget(target)).toEqual({ segments, search });
  });
});
