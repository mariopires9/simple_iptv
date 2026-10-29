// PLY-06 B: the root-cause probe of a failed stream — redirects to http://, playlists with http://
// segments, HEVC, no CORS vs unreachable — with a fake fetch. Never an unmasked URL in the result
// or in the log.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { probeAttempts } from './probeAttempts';
import { probeStream, type ProbeFetch } from './probeStream';
import { HEVC_AAC, H264_AAC, fakeResponse, tsWithStreamTypes } from './test-utils/fakes';
import { PlaybackError } from '../types';

// Fictitious values only (CLAUDE.md).
const HOST = 'panel.example.test';
const TS = `https://${HOST}/live/jdoe/s3cretpw/42.ts`;
const M3U8 = `https://${HOST}/live/jdoe/s3cretpw/42.m3u8`;
const HTTPS = { pageProtocol: 'https:' };

afterEach(() => {
  vi.useRealTimers();
  clearLogBuffer();
});

type Step = Response | Error;

/** A fetch answering each call with the next step; records the init of every call. */
function fakeFetch(...steps: Step[]) {
  const calls: RequestInit[] = [];
  const impl: ProbeFetch = (_input, init) => {
    calls.push(init);
    const step = steps.shift();
    if (step === undefined) return Promise.reject(new Error('unexpected request'));
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  return { impl, calls };
}

const typeError = () => new TypeError('Load failed');

function expectMasked(value: unknown) {
  const text = JSON.stringify(value) + JSON.stringify(getLogEntries());
  expect(text).not.toContain(HOST);
  expect(text).not.toContain('jdoe');
  expect(text).not.toContain('s3cretpw');
}

describe('probeStream — mixed content', () => {
  it('an http:// stream on an https page is reported without any request', async () => {
    const { impl, calls } = fakeFetch();
    const result = await probeStream(`http://${HOST}/live/jdoe/s3cretpw/42.ts`, {
      fetch: impl,
      ...HTTPS,
    });
    expect(result).toEqual({ cause: 'insecure-url', target: 'http://***/live/***/***/***.ts' });
    expect(calls).toHaveLength(0);
  });

  it('a readable response redirected to http:// is an insecure redirect', async () => {
    const response = fakeResponse({
      url: 'http://10.0.0.1:8080/live/jdoe/s3cretpw/42.ts',
      redirected: true,
      body: tsWithStreamTypes(H264_AAC),
    });
    const { impl } = fakeFetch(response);
    const result = await probeStream(TS, { fetch: impl, ...HTTPS });
    expect(result).toMatchObject({ cause: 'insecure-redirect', redirected: true, status: 200 });
    expectMasked(result);
  });

  it('CORS request blocked, server redirects, redirect cannot be followed → redirect-blocked', async () => {
    const { impl, calls } = fakeFetch(
      typeError(),
      fakeResponse({ type: 'opaqueredirect' }),
      typeError(),
    );
    const result = await probeStream(M3U8, { fetch: impl, ...HTTPS });
    expect(result).toEqual({
      cause: 'redirect-blocked',
      redirected: true,
      target: 'https://***/live/***/***/***.m3u8',
    });
    expect(calls.map((c) => [c.mode ?? 'cors', c.redirect])).toEqual([
      ['cors', 'follow'],
      ['no-cors', 'manual'],
      ['no-cors', 'follow'],
    ]);
    // No cookies, no referrer.
    expect(calls.every((c) => c.credentials === 'omit' && c.referrerPolicy === 'no-referrer')).toBe(
      true,
    );
    expectMasked(result);
  });

  it('a playlist listing http:// segments is insecure-segments', async () => {
    const playlist = '#EXTM3U\n#EXTINF:10,\nhttp://10.0.0.1:8080/hls/1.ts\n';
    const { impl } = fakeFetch(fakeResponse({ url: M3U8, body: playlist }));
    expect(await probeStream(M3U8, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'insecure-segments',
      content: 'playlist',
    });
  });

  it('on an http page (local development) http:// segments are not mixed content', async () => {
    const playlist = '#EXTM3U\n#EXTINF:10,\nhttp://10.0.0.1:8080/hls/1.ts\n';
    const { impl } = fakeFetch(fakeResponse({ url: M3U8, body: playlist }));
    expect(await probeStream(M3U8, { fetch: impl, pageProtocol: 'http:' })).toMatchObject({
      cause: 'ok',
    });
  });
});

describe('probeStream — CORS and reachability', () => {
  it('CORS blocked but reachable without redirect → no-cors', async () => {
    const { impl } = fakeFetch(typeError(), fakeResponse({ type: 'opaque' }));
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({ cause: 'no-cors' });
  });

  it('redirect followed in no-cors mode works → no-cors (redirected)', async () => {
    const { impl } = fakeFetch(
      typeError(),
      fakeResponse({ type: 'opaqueredirect' }),
      fakeResponse({ type: 'opaque' }),
    );
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'no-cors',
      redirected: true,
    });
  });

  it('every request fails → unreachable (no CORS or unreachable: the browser does not say)', async () => {
    const { impl, calls } = fakeFetch(typeError(), typeError());
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'unreachable',
    });
    expect(calls).toHaveLength(2);
  });

  it('401/403 → auth; 404 → http-error', async () => {
    expect(
      await probeStream(TS, { fetch: fakeFetch(fakeResponse({ status: 403 })).impl, ...HTTPS }),
    ).toMatchObject({ cause: 'auth', status: 403 });
    expect(
      await probeStream(TS, { fetch: fakeFetch(fakeResponse({ status: 404 })).impl, ...HTTPS }),
    ).toMatchObject({ cause: 'http-error', status: 404 });
  });

  it('an HTML page is not-media', async () => {
    const { impl } = fakeFetch(fakeResponse({ body: '<html>Account expired</html>' }));
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'not-media',
      content: 'text',
    });
  });

  it('plain text served as text/plain is not-media; unknown binary is not judged', async () => {
    const text = fakeResponse({ body: 'Account expired' });
    text.headers.set('content-type', 'text/plain');
    expect(await probeStream(TS, { fetch: fakeFetch(text).impl, ...HTTPS })).toMatchObject({
      cause: 'not-media',
    });
    const binary = fakeResponse({ body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
    binary.headers.set('content-type', 'application/octet-stream');
    expect(await probeStream(TS, { fetch: fakeFetch(binary).impl, ...HTTPS })).toMatchObject({
      cause: 'ok',
      content: 'other',
    });
  });

  it('an MP4 (VOD) answer is ok, not "not a stream"', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode('ftypisom')]);
    const { impl } = fakeFetch(fakeResponse({ body: mp4 }));
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'ok',
      content: 'media',
    });
  });

  it('an invalid address is reported without a request', async () => {
    const { impl, calls } = fakeFetch();
    expect(await probeStream('javascript:alert(1)', { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'invalid-url',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('probeStream — content', () => {
  it('MPEG-TS with H.264 is ok', async () => {
    const { impl } = fakeFetch(fakeResponse({ body: tsWithStreamTypes(H264_AAC) }));
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toEqual({
      cause: 'ok',
      content: 'ts',
      status: 200,
      target: 'https://***/live/***/***/***.ts',
    });
  });

  it('MPEG-TS with HEVC → ok with the HEVC hint', async () => {
    const { impl } = fakeFetch(fakeResponse({ body: tsWithStreamTypes(HEVC_AAC) }));
    expect(await probeStream(TS, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'ok',
      hevc: true,
    });
  });

  it('master playlist: the first variant is read too (http:// segments there)', async () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001f"\nchunks.m3u8\n';
    const variant = '#EXTM3U\n#EXTINF:10,\nhttp://10.0.0.1:8080/hls/1.ts\n';
    const { impl, calls } = fakeFetch(
      fakeResponse({ url: M3U8, body: master }),
      fakeResponse({ url: `https://${HOST}/live/jdoe/s3cretpw/chunks.m3u8`, body: variant }),
    );
    const result = await probeStream(M3U8, { fetch: impl, ...HTTPS });
    expect(result).toMatchObject({ cause: 'insecure-segments', content: 'playlist' });
    expect(calls).toHaveLength(2);
    expectMasked(result);
  });

  it('master playlist whose variant cannot be read: judged on the master alone', async () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://other.example.test/v.m3u8\n';
    const { impl } = fakeFetch(fakeResponse({ url: M3U8, body: master }), typeError());
    expect(await probeStream(M3U8, { fetch: impl, ...HTTPS })).toMatchObject({ cause: 'ok' });
  });

  it('playlist with HEVC CODECS → HEVC hint', async () => {
    const playlist =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1.1.6.L120.90,mp4a.40.2"\nv.m3u8\n';
    const { impl } = fakeFetch(fakeResponse({ url: M3U8, body: playlist }));
    expect(await probeStream(M3U8, { fetch: impl, ...HTTPS })).toMatchObject({
      cause: 'ok',
      content: 'playlist',
      hevc: true,
    });
  });

  it('reads only the first bytes of an endless stream, then cancels it', async () => {
    const response = fakeResponse({ endless: true, body: tsWithStreamTypes(H264_AAC) });
    const { impl } = fakeFetch(response);
    const result = await probeStream(TS, { fetch: impl, ...HTTPS, maxBytes: 4096 });
    expect(result.cause).toBe('ok');
    expect(response.cancelled()).toBe(true);
  });

  it('a stalled response ends as timeout and aborts the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const impl: ProbeFetch = (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      });
    };
    const pending = probeStream(TS, { fetch: impl, ...HTTPS, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ cause: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('the caller aborting resolves as timeout (never rejects)', async () => {
    const controller = new AbortController();
    controller.abort();
    const impl: ProbeFetch = (_url, init) =>
      init.signal?.aborted
        ? Promise.reject(new DOMException('', 'AbortError'))
        : new Promise(() => {});
    await expect(
      probeStream(TS, { fetch: impl, ...HTTPS, signal: controller.signal }),
    ).resolves.toMatchObject({ cause: 'timeout' });
  });
});

describe('probeAttempts', () => {
  const descriptor = {
    url: TS,
    kind: 'live' as const,
    container: 'ts' as const,
    fallbacks: [{ url: M3U8, kind: 'live' as const, container: 'hls' as const }],
  };
  const attempts = [
    {
      engine: 'mpegts' as const,
      container: 'ts' as const,
      error: new PlaybackError({ kind: 'blocked' }),
    },
    {
      engine: 'native' as const,
      container: 'hls' as const,
      error: new PlaybackError({ kind: 'unsupported-container' }),
    },
  ];

  it('probes each tried address in order; no-cors means something else for the native player', async () => {
    const { impl } = fakeFetch(
      typeError(),
      fakeResponse({ type: 'opaque' }),
      typeError(),
      fakeResponse({ type: 'opaque' }),
    );
    const probes = await probeAttempts(descriptor, attempts, { fetch: impl, ...HTTPS });
    expect(probes.map((p) => [p.index, p.result.cause, p.finding])).toEqual([
      [0, 'no-cors', 'no-cors'],
      [1, 'no-cors', 'no-cors-native'],
    ]);
  });

  it('skipped candidates are not probed; one address tried twice is requested once', async () => {
    const same = { ...descriptor, fallbacks: [{ ...descriptor.fallbacks[0]!, url: TS }] };
    const { impl, calls } = fakeFetch(fakeResponse({ body: tsWithStreamTypes(H264_AAC) }));
    const probes = await probeAttempts(same, attempts, { fetch: impl, ...HTTPS });
    expect(probes.map((p) => p.finding)).toEqual(['ok', 'ok']);
    expect(calls).toHaveLength(1);

    const skipped = [{ ...attempts[0]!, engine: 'unsupported' as const }, attempts[1]!];
    const second = fakeFetch(fakeResponse({ url: M3U8, body: '#EXTM3U\n' }));
    const only = await probeAttempts(descriptor, skipped, { fetch: second.impl, ...HTTPS });
    expect(only.map((p) => p.index)).toEqual([1]);
  });
});
