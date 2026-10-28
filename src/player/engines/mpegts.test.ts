import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import type { UrlRewriter } from '@/core/net';
import { FakeVideo, stubObjectUrls } from '../test-utils/fakeVideo';
import { libState, resetLibState } from '../test-utils/libMocks';
import type { PlaybackError, StreamDescriptor } from '../types';
import { createMpegtsEngine, mpegtsConfig, resetMpegtsLoggingForTests } from './mpegts';

vi.mock('mpegts.js', async () => (await import('../test-utils/libMocks')).mpegtsModule());

const LIVE: StreamDescriptor = {
  url: 'http://a.test/live/alice/s3cret/7.ts',
  kind: 'live',
  container: 'ts',
};
const identity: UrlRewriter = { rewrite: (u) => u };

let urls: ReturnType<typeof stubObjectUrls>;
beforeEach(() => {
  resetLibState();
  resetMpegtsLoggingForTests();
  clearLogBuffer();
  urls = stubObjectUrls();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  urls.restore();
  vi.restoreAllMocks();
});

async function loaded(descriptor = LIVE, rewriter: UrlRewriter = identity) {
  const video = new FakeVideo();
  const engine = createMpegtsEngine({ rewriter, pageProtocol: 'https:' });
  const errors: PlaybackError[] = [];
  engine.on('error', (e) => errors.push(e));
  engine.attach(video.asElement());
  await engine.load(descriptor);
  const player = libState.mpegts.at(-1);
  if (!player) throw new Error('no mpegts player');
  return { video, engine, errors, player };
}

describe('mpegts engine', () => {
  it('lazy-loads mpegts.js and plays a live TS with the rewritten URL', async () => {
    const rewrite = vi.fn((u: string) => `https://proxy.test/?u=${encodeURIComponent(u)}`);
    const { player, video } = await loaded(LIVE, { rewrite });
    expect(rewrite).toHaveBeenCalledWith(LIVE.url, 'stream');
    expect(player.dataSource).toEqual({
      type: 'mpegts',
      isLive: true,
      url: `https://proxy.test/?u=${encodeURIComponent(LIVE.url)}`,
    });
    expect(player.config).toEqual(mpegtsConfig(true));
    expect(player.load).toHaveBeenCalledTimes(1);
    expect(video.src).toMatch(/^blob:fake\//);
  });

  it('config: worker off, isLive for live, lazyLoad only for VOD', () => {
    expect(mpegtsConfig(true)).toMatchObject({
      enableWorker: false,
      isLive: true,
      lazyLoad: false,
    });
    expect(mpegtsConfig(false)).toMatchObject({
      enableWorker: false,
      isLive: false,
      lazyLoad: true,
    });
  });

  it('plays FLV as flv and VOD with isLive false', async () => {
    const { player } = await loaded({ url: 'https://a.test/v.flv', kind: 'vod', container: 'flv' });
    expect(player.dataSource).toMatchObject({ type: 'flv', isLive: false });
  });

  it('VOD resume: seeks through the player once metadata says it is seekable', async () => {
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    const notices = vi.fn();
    engine.on('notice', notices);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/v.ts', kind: 'vod', container: 'ts' }, 600);
    const player = libState.mpegts[0];
    expect(player?.currentTime).toBe(0); // not before metadata
    video.seekableRanges = [[0, 5400]];
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(player?.currentTime).toBe(600);
    expect(notices).not.toHaveBeenCalled();
  });

  it('VOD resume on a non-seekable TS: resume-unsupported notice, starts from the beginning', async () => {
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    const notices = vi.fn();
    engine.on('notice', notices);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/v.ts', kind: 'vod', container: 'ts' }, 600);
    video.dispatchEvent(new Event('loadedmetadata')); // seekable is empty
    expect(libState.mpegts[0]?.currentTime).toBe(0);
    expect(notices).toHaveBeenCalledWith({ type: 'resume-unsupported', startAt: 600 });
  });

  it('live: startAt is ignored and the resume listener is not installed', async () => {
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    await engine.load(LIVE, 600);
    expect(video.listenerCount('loadedmetadata')).toBe(0);
  });

  it('destroy removes the resume listener', async () => {
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/v.ts', kind: 'vod', container: 'ts' }, 600);
    expect(video.listenerCount('loadedmetadata')).toBe(1);
    await engine.destroy();
    expect(video.listenerCount()).toBe(0);
  });

  it('maps library errors', async () => {
    const { player, errors } = await loaded();
    player.error('NetworkError', 'HttpStatusCodeInvalid', { code: 401, msg: 'Unauthorized' });
    player.error('NetworkError', 'Exception', { code: -1, msg: 'Failed to fetch' });
    expect(errors.map((e) => e.kind)).toEqual(['auth', 'blocked']);
    expect(errors[1]?.hint).toBe('mixed-content');
  });

  it('silences the library console and forwards warnings redacted', async () => {
    await loaded();
    expect(libState.mpegtsLogging.enableAll).toBe(false);
    expect(libState.mpegtsLogListeners).toHaveLength(1);
    libState.mpegtsLogListeners[0]?.('error', `[IOController] > fetch ${LIVE.url}?password=s3cret`);
    libState.mpegtsLogListeners[0]?.('debug', 'ignored');
    const entries = getLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).not.toContain('s3cret');
    expect(entries[0]?.message).not.toContain('alice');
  });

  it('configures logging only once', async () => {
    await loaded();
    await loaded();
    expect(libState.mpegtsLogListeners).toHaveLength(1);
  });

  it('destroy removes the handler, destroys the player and releases the element', async () => {
    const { player, video, engine, errors } = await loaded();
    video.srcObject = { managed: true }; // ManagedMediaSource is attached through srcObject
    expect(player.count('error')).toBe(1);
    await engine.destroy();
    expect(player.count('error')).toBe(0);
    expect(player.destroy).toHaveBeenCalledTimes(1);
    expect(urls.live.size).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(1);
    player.error('NetworkError', 'Exception');
    expect(errors).toHaveLength(0);
  });

  it('destroy while mpegts.js is downloading: no player is created', async () => {
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    const pending = engine.load(LIVE);
    await engine.destroy();
    await pending;
    expect(libState.mpegts).toHaveLength(0);
  });

  it('rejects with unsupported-container when mpegts.js reports no MSE', async () => {
    libState.mpegtsSupported = false;
    const video = new FakeVideo();
    const engine = createMpegtsEngine({ rewriter: identity });
    engine.attach(video.asElement());
    await expect(engine.load(LIVE)).rejects.toMatchObject({ kind: 'unsupported-container' });
  });
});
