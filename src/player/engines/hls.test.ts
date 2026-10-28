import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UrlRewriter } from '@/core/net';
import { FakeVideo, stubObjectUrls } from '../test-utils/fakeVideo';
import { libState, resetLibState } from '../test-utils/libMocks';
import type { PlaybackError, StreamDescriptor } from '../types';
import { HLS_CONFIG, createHlsEngine } from './hls';

vi.mock('hls.js', async () => (await import('../test-utils/libMocks')).hlsModule());

const LIVE: StreamDescriptor = {
  url: 'https://a.test/live/u/p/1.m3u8',
  kind: 'live',
  container: 'hls',
};
const identity: UrlRewriter = { rewrite: (u) => u };

let urls: ReturnType<typeof stubObjectUrls>;
beforeEach(() => {
  resetLibState();
  urls = stubObjectUrls();
});
afterEach(() => urls.restore());

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

describe('hls engine', () => {
  it('lazy-loads hls.js, attaches the element and loads the source', async () => {
    const { hls, video } = await loaded();
    expect(libState.hls).toHaveLength(1);
    expect(hls.attached).toBe(true);
    expect(hls.source).toBe(LIVE.url);
    expect(video.src).toMatch(/^blob:fake\//);
  });

  it('uses the documented config (worker on, low latency off, live sync)', async () => {
    const { hls } = await loaded(LIVE, identity, 120);
    expect(hls.config).toMatchObject({
      enableWorker: true,
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      startPosition: 120,
    });
    expect(HLS_CONFIG.liveMaxLatencyDurationCount).toBeGreaterThan(
      HLS_CONFIG.liveSyncDurationCount ?? 0,
    );
    expect((await loaded()).hls.config.startPosition).toBe(-1);
  });

  it('routes every request through the rewriter (playlists and segments)', async () => {
    const rewrite = vi.fn(
      (url: string, purpose: string) => `https://proxy.test/${purpose}/${encodeURIComponent(url)}`,
    );
    const { hls } = await loaded(LIVE, { rewrite });
    const xhrSetup = hls.config.xhrSetup as (
      xhr: { open: (...a: unknown[]) => void },
      url: string,
      ctx: object,
    ) => void;
    const xhr = { open: vi.fn() };

    xhrSetup(xhr, 'https://a.test/live/u/p/1.m3u8', { type: 'manifest' });
    xhrSetup(xhr, 'https://a.test/seg/1.ts', { frag: {} });
    expect(rewrite).toHaveBeenCalledWith('https://a.test/live/u/p/1.m3u8', 'playlist');
    expect(rewrite).toHaveBeenCalledWith('https://a.test/seg/1.ts', 'stream');
    expect(xhr.open).toHaveBeenNthCalledWith(
      1,
      'GET',
      `https://proxy.test/playlist/${encodeURIComponent(LIVE.url)}`,
      true,
    );
    expect(xhr.open).toHaveBeenNthCalledWith(
      2,
      'GET',
      `https://proxy.test/stream/${encodeURIComponent('https://a.test/seg/1.ts')}`,
      true,
    );
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

  it('tries recoverMediaError once before reporting a fatal media error', async () => {
    const { hls, errors } = await loaded();
    const media = { type: 'mediaError', details: 'bufferAppendError', fatal: true };
    hls.error(media);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);
    hls.error(media);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(errors[0]).toMatchObject({ kind: 'decode' });
  });

  it('reports codec errors without trying to recover', async () => {
    const { hls, errors } = await loaded();
    hls.error({ type: 'mediaError', details: 'bufferAddCodecError', fatal: true });
    expect(hls.recoverMediaError).not.toHaveBeenCalled();
    expect(errors[0]).toMatchObject({ kind: 'unsupported-codec' });
  });

  it('destroy removes the handler, destroys hls.js and releases the element', async () => {
    const { hls, video, engine, errors } = await loaded();
    expect(hls.count('hlsError')).toBe(1);
    await engine.destroy();
    expect(hls.count('hlsError')).toBe(0);
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
