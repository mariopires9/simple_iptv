import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UrlRewriter } from '@/core/net';
import { FakeVideo, stubObjectUrls } from '../test-utils/fakeVideo';
import { libState, resetLibState } from '../test-utils/libMocks';
import type { PlaybackError, StreamDescriptor } from '../types';
import { HLS_CONFIG, createHlsEngine, createRecoveryPolicy } from './hls';

vi.mock('hls.js', async () => (await import('../test-utils/libMocks')).hlsModule());

const LIVE: StreamDescriptor = {
  url: 'https://a.test/live/u/p/1.m3u8',
  kind: 'live',
  container: 'hls',
};
const VOD: StreamDescriptor = {
  url: 'https://a.test/movie/u/p/9.m3u8',
  kind: 'vod',
  container: 'hls',
};
const identity: UrlRewriter = { rewrite: (u) => u };
const proxy = (url: string) => `https://proxy.test/?u=${encodeURIComponent(url)}`;

let urls: ReturnType<typeof stubObjectUrls>;
beforeEach(() => {
  resetLibState();
  urls = stubObjectUrls();
});
afterEach(() => {
  urls.restore();
  vi.useRealTimers();
});

async function loaded(descriptor = LIVE, rewriter: UrlRewriter = identity, startAt?: number) {
  const video = new FakeVideo();
  const engine = createHlsEngine({ rewriter, pageProtocol: 'https:' });
  const errors: PlaybackError[] = [];
  engine.on('error', (e) => errors.push(e));
  engine.attach(video.asElement());
  await engine.load(descriptor, startAt);
  const hls = libState.hls.at(-1);
  if (!hls) throw new Error('no Hls instance');
  return { video, engine, errors, hls };
}

const MEDIA_ERROR = { type: 'mediaError', details: 'bufferAppendError', fatal: true };

describe('hls engine', () => {
  it('lazy-loads hls.js, attaches the element and loads the original source URL', async () => {
    const { hls, video } = await loaded(LIVE, { rewrite: proxy });
    expect(libState.hls).toHaveLength(1);
    expect(hls.attached).toBe(true);
    // The loader rewrites at request time; hls.js keeps the original URL as the playlist URL.
    expect(hls.source).toBe(LIVE.url);
    expect(video.src).toMatch(/^blob:fake\//);
  });

  it('uses the documented config (worker on, low latency off, live sync)', async () => {
    const { hls } = await loaded(VOD, identity, 120);
    expect(hls.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      startPosition: 120,
    });
    expect(hls.config.xhrSetup).toBeUndefined();
    expect(HLS_CONFIG.liveMaxLatencyDurationCount).toBeGreaterThan(
      HLS_CONFIG.liveSyncDurationCount ?? 0,
    );
    expect((await loaded(VOD)).hls.config.startPosition).toBe(-1);
  });

  it('ignores startAt for live streams', async () => {
    const { hls } = await loaded(LIVE, identity, 120);
    expect(hls.config.startPosition).toBe(-1);
  });

  it('every request goes through the rewriter, once, with the purpose from the context type', async () => {
    const rewrite = vi.fn(proxy);
    const { hls } = await loaded(LIVE, { rewrite });
    rewrite.mockClear();
    hls.request('https://a.test/live/u/p/1.m3u8', 'manifest');
    hls.request('https://a.test/live/u/p/v1.m3u8', 'level');
    hls.request('https://a.test/keys/k1', 'key');
    hls.request('https://a.test/seg/1.ts', 'media-fragment');
    expect(rewrite.mock.calls).toEqual([
      ['https://a.test/live/u/p/1.m3u8', 'playlist'],
      ['https://a.test/live/u/p/v1.m3u8', 'playlist'],
      ['https://a.test/keys/k1', 'playlist'],
      ['https://a.test/seg/1.ts', 'stream'],
    ]);
    expect(libState.hlsRequests).toEqual([
      proxy('https://a.test/live/u/p/1.m3u8'),
      proxy('https://a.test/live/u/p/v1.m3u8'),
      proxy('https://a.test/keys/k1'),
      proxy('https://a.test/seg/1.ts'),
    ]);
  });

  it('maps fatal errors and ignores non-fatal ones', async () => {
    const { hls, errors } = await loaded();
    hls.error({ type: 'networkError', details: 'fragLoadError', fatal: false });
    expect(errors).toHaveLength(0);
    hls.error({
      type: 'networkError',
      details: 'manifestLoadError',
      fatal: true,
      response: { code: 403 },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'auth', status: 403, engine: 'hls' });
  });

  it('two media errors separated by healthy playback both recover', async () => {
    const { hls, errors } = await loaded();
    hls.error(MEDIA_ERROR);
    hls.fragBuffered();
    hls.error(MEDIA_ERROR);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(0);
  });

  it('a media error right after a recovery without progress is reported', async () => {
    const { hls, errors } = await loaded();
    hls.error(MEDIA_ERROR);
    hls.error(MEDIA_ERROR);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(errors[0]).toMatchObject({ kind: 'decode' });
  });

  it('caps recoveries at 3 per 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const { hls, errors } = await loaded();
    for (let i = 0; i < 3; i++) {
      hls.error(MEDIA_ERROR);
      hls.fragBuffered();
      vi.setSystemTime((i + 1) * 10_000);
    }
    hls.error(MEDIA_ERROR); // 4th within 60 s
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(1);
  });

  it('reports codec errors without trying to recover', async () => {
    const { hls, errors } = await loaded();
    hls.error({ type: 'mediaError', details: 'bufferAddCodecError', fatal: true });
    expect(hls.recoverMediaError).not.toHaveBeenCalled();
    expect(errors[0]).toMatchObject({ kind: 'unsupported-codec' });
  });

  it('codec errors carry the refused codecs when hls.js reports the MIME type (PLY-04 AC2)', async () => {
    const { hls, errors } = await loaded();
    hls.error({
      type: 'mediaError',
      details: 'bufferAddCodecError',
      fatal: true,
      mimeType: 'video/mp4;codecs=hvc1.1.6.L93.B0',
      sourceBufferName: 'video',
    });
    expect(errors[0]).toMatchObject({ kind: 'unsupported-codec', codec: 'hvc1.1.6.L93.B0' });
  });

  it('a refused audio SourceBuffer is a non-fatal "audio unsupported" notice (PLY-04 AC3)', async () => {
    const { hls, errors, engine } = await loaded();
    const notices: unknown[] = [];
    engine.on('notice', (n) => notices.push(n));
    hls.error({
      type: 'mediaError',
      details: 'bufferAddCodecError',
      fatal: false,
      mimeType: 'audio/mp4;codecs=ac-3',
      sourceBufferName: 'audio',
    });
    expect(errors).toHaveLength(0);
    expect(notices).toEqual([{ type: 'audio-unsupported', codec: 'ac-3' }]);
    // A non-fatal codec error on another buffer is not about the audio.
    hls.error({
      type: 'mediaError',
      details: 'bufferAddCodecError',
      fatal: false,
      sourceBufferName: 'video',
    });
    expect(notices).toHaveLength(1);
  });

  it('destroy removes the handlers, destroys hls.js and releases the element', async () => {
    const { hls, video, engine, errors } = await loaded();
    expect(hls.count('hlsError')).toBe(1);
    expect(hls.count('hlsFragBuffered')).toBe(1);
    await engine.destroy();
    expect(hls.count('hlsError')).toBe(0);
    expect(hls.count('hlsFragBuffered')).toBe(0);
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(urls.live.size).toBe(0);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(1);
    hls.error({ type: 'networkError', details: 'fragLoadError', fatal: true });
    expect(errors).toHaveLength(0);
  });

  it('revokes a leftover blob: URL if the library did not', async () => {
    libState.leakObjectUrl = true;
    const { engine, video } = await loaded();
    const blob = video.src;
    await engine.destroy();
    expect(urls.revoke).toHaveBeenCalledWith(blob);
    expect(urls.live.size).toBe(0);
  });

  it('destroy while hls.js is downloading: nothing is created', async () => {
    const video = new FakeVideo();
    const engine = createHlsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    const pending = engine.load(LIVE);
    await engine.destroy();
    await pending;
    expect(libState.hls).toHaveLength(0);
  });

  it('rejects with unsupported-container when hls.js reports no MSE', async () => {
    libState.hlsSupported = false;
    const video = new FakeVideo();
    const engine = createHlsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    await expect(engine.load(LIVE)).rejects.toMatchObject({ kind: 'unsupported-container' });
    expect(libState.hls).toHaveLength(0);
  });
});

describe('createRecoveryPolicy', () => {
  it('allows max recoveries per window, each after progress, and frees slots as time passes', () => {
    let t = 0;
    const policy = createRecoveryPolicy(2, 1000, () => t);
    expect(policy.shouldRecover()).toBe(true);
    expect(policy.shouldRecover()).toBe(false); // no progress since the last recovery
    policy.healthy();
    t = 100;
    expect(policy.shouldRecover()).toBe(true);
    policy.healthy();
    t = 500;
    expect(policy.shouldRecover()).toBe(false); // 2 in the window
    t = 1000;
    expect(policy.shouldRecover()).toBe(true); // the first one left the window
  });
});
