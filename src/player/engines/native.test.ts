import { describe, expect, it, vi } from 'vitest';
import type { UrlRewriter } from '@/core/net';
import { FakeVideo } from '../test-utils/fakeVideo';
import type { PlaybackError } from '../types';
import { createNativeEngine } from './native';

const rewriter = (): UrlRewriter & { rewrite: ReturnType<typeof vi.fn> } => ({
  rewrite: vi.fn(
    (url: string, purpose: string) => `https://proxy.test/${purpose}?u=${encodeURIComponent(url)}`,
  ),
});

describe('native engine', () => {
  it('sets the rewritten URL as the element source', async () => {
    const video = new FakeVideo();
    const r = rewriter();
    const engine = createNativeEngine({ rewriter: r });
    engine.attach(video.asElement());
    await engine.load({ url: 'http://a.test/movie.mp4', kind: 'vod', container: 'mp4' });
    expect(r.rewrite).toHaveBeenCalledWith('http://a.test/movie.mp4', 'stream');
    expect(video.src).toBe(
      `https://proxy.test/stream?u=${encodeURIComponent('http://a.test/movie.mp4')}`,
    );
  });

  it('rewrites a native HLS URL as a playlist', async () => {
    const video = new FakeVideo();
    const r = rewriter();
    const engine = createNativeEngine({ rewriter: r });
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/live.m3u8', kind: 'live', container: 'hls' });
    expect(r.rewrite).toHaveBeenCalledWith('https://a.test/live.m3u8', 'playlist');
  });

  it('reports media errors through on("error")', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u }, pageProtocol: 'https:' });
    const errors: PlaybackError[] = [];
    engine.on('error', (e) => errors.push(e));
    engine.attach(video.asElement());
    await engine.load({ url: 'http://a.test/u/p/1.mkv', kind: 'vod', container: 'mkv' });
    video.fail(4);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'blocked', hint: 'mixed-content', engine: 'native' });
  });

  it('VOD: seeks to startAt once metadata is loaded, if seekable', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    const notices = vi.fn();
    engine.on('notice', notices);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/m.mp4', kind: 'vod', container: 'mp4' }, 42);
    expect(video.currentTime).toBe(0);
    video.seekableRanges = [[0, 3600]];
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
    expect(notices).not.toHaveBeenCalled();
  });

  it('VOD: startAt outside the seekable range → resume-unsupported notice, no seek', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    const notices = vi.fn();
    engine.on('notice', notices);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/m.mkv', kind: 'vod', container: 'mkv' }, 42);
    video.seekableRanges = [[0, 10]];
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(0);
    expect(notices).toHaveBeenCalledWith({ type: 'resume-unsupported', startAt: 42 });
  });

  it('live: startAt is ignored', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    const notices = vi.fn();
    engine.on('notice', notices);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/live.m3u8', kind: 'live', container: 'hls' }, 42);
    expect(video.listenerCount('loadedmetadata')).toBe(0);
    video.seekableRanges = [[0, 3600]];
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(0);
    expect(notices).not.toHaveBeenCalled();
  });

  it('destroy removes its listeners and empties the element', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    const onError = vi.fn();
    engine.on('error', onError);
    engine.attach(video.asElement());
    await engine.load({ url: 'https://a.test/m.mp4', kind: 'vod', container: 'mp4' }, 10);
    expect(video.listenerCount()).toBe(2);

    await engine.destroy();
    expect(video.listenerCount()).toBe(0);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(1);
    video.fail(2);
    expect(onError).not.toHaveBeenCalled();

    await engine.destroy(); // idempotent
    expect(video.load).toHaveBeenCalledTimes(1);
  });

  it('load after destroy does nothing', async () => {
    const video = new FakeVideo();
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    engine.attach(video.asElement());
    await engine.destroy();
    await engine.load({ url: 'https://a.test/m.mp4', kind: 'vod', container: 'mp4' });
    expect(video.getAttribute('src')).toBeNull();
  });

  it('load without attach throws', async () => {
    const engine = createNativeEngine({ rewriter: { rewrite: (u) => u } });
    await expect(
      engine.load({ url: 'https://a.test/m.mp4', kind: 'vod', container: 'mp4' }),
    ).rejects.toThrow('attach() must be called before load()');
  });
});
