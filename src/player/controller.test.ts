import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '@/core/platform';
import { createPlayerController } from './controller';
import type { PlayerEvents } from './controller';
import { FakeVideo, stubObjectUrls } from './test-utils/fakeVideo';
import { libState, resetLibState } from './test-utils/libMocks';
import { PlaybackError } from './types';
import type { EngineFactory, EngineId, PlayerEngine, StreamDescriptor } from './types';

vi.mock('hls.js', async () => (await import('./test-utils/libMocks')).hlsModule());
vi.mock('mpegts.js', async () => (await import('./test-utils/libMocks')).mpegtsModule());

const CHROME: Capabilities = {
  mse: true,
  mms: false,
  nativeHls: false,
  canPlay: () => true,
  isIOS: false,
  isSafari: false,
  pip: true,
  fullscreenApi: true,
};
const LEGACY_IOS: Capabilities = {
  ...CHROME,
  mse: false,
  nativeHls: true,
  isIOS: true,
  isSafari: true,
};

const ts = (n: number | string = 1): StreamDescriptor => ({
  url: `http://a.test/live/u/p/${n}.ts`,
  kind: 'live',
  container: 'ts',
});
const m3u8 = (n: number | string = 1): StreamDescriptor => ({
  url: `http://a.test/live/u/p/${n}.m3u8`,
  kind: 'live',
  container: 'hls',
});
const mp4 = (n: number | string = 1): StreamDescriptor => ({
  url: `http://a.test/movie/u/p/${n}.mp4`,
  kind: 'vod',
  container: 'mp4',
});

/** Scriptable engine for controller tests. */
class FakeEngine implements PlayerEngine {
  static created: FakeEngine[] = [];
  readonly listeners = new Set<(e: PlaybackError) => void>();
  readonly load = vi.fn(async (_stream: StreamDescriptor, _startAt?: number) => {
    if (this.loadError) throw this.loadError;
  });
  readonly destroy = vi.fn(async () => undefined);
  attached: HTMLVideoElement | undefined;
  loadError: PlaybackError | undefined;

  constructor(readonly id: EngineId) {
    FakeEngine.created.push(this);
  }

  attach(video: HTMLVideoElement) {
    this.attached = video;
  }

  on(_evt: 'error', cb: (e: PlaybackError) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  fail(error: PlaybackError) {
    for (const cb of [...this.listeners]) cb(error);
  }
}

/** Factories producing FakeEngines; `failLoad` makes the next engine of that id reject load(). */
function fakeEngines(failLoad: Partial<Record<EngineId, PlaybackError[]>> = {}) {
  const make =
    (id: EngineId): EngineFactory =>
    () => {
      const engine = new FakeEngine(id);
      engine.loadError = failLoad[id]?.shift();
      return engine;
    };
  return { native: make('native'), hls: make('hls'), mpegts: make('mpegts') };
}

function record(controller: ReturnType<typeof createPlayerController>) {
  const events: Array<[keyof PlayerEvents, unknown]> = [];
  controller.on('attempt', (p) =>
    events.push(['attempt', `${p.engine}:${p.descriptor.container}:${p.attempt}`]),
  );
  controller.on('fallback', (p) =>
    events.push(['fallback', `${p.error.kind}->${p.next.container}`]),
  );
  controller.on('error', (e) => events.push(['error', e.kind]));
  return events;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeEngine.created = [];
  resetLibState();
});

describe('player controller — selection and fallbacks (fake engines)', () => {
  it('plays with the selected engine on the given element', async () => {
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), {
      capabilities: CHROME,
      engines: fakeEngines(),
    });
    const events = record(controller);
    await controller.play(ts(), { startAt: 5 });
    expect(controller.engine).toBe('mpegts');
    expect(FakeEngine.created).toHaveLength(1);
    expect(FakeEngine.created[0]?.attached).toBe(video.asElement());
    expect(FakeEngine.created[0]?.load).toHaveBeenCalledWith(ts(), 5);
    expect(events).toEqual([['attempt', 'mpegts:ts:0']]);
  });

  it('load failure with a fallback: tries the next descriptor once, then succeeds', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines({ mpegts: [new PlaybackError({ kind: 'unsupported-codec' })] }),
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    expect(events).toEqual([
      ['attempt', 'mpegts:ts:0'],
      ['fallback', 'unsupported-codec->hls'],
      ['attempt', 'hls:hls:1'],
    ]);
    expect(FakeEngine.created[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(controller.engine).toBe('hls');
  });

  it('asynchronous engine error with a fallback: falls back', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines(),
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    FakeEngine.created[0]?.fail(new PlaybackError({ kind: 'network' }));
    FakeEngine.created[0]?.fail(new PlaybackError({ kind: 'network' })); // duplicate: ignored
    await flush();
    expect(events.map(([e]) => e)).toEqual(['attempt', 'fallback', 'attempt']);
    expect(FakeEngine.created).toHaveLength(2);
    expect(controller.engine).toBe('hls');
  });

  it('every candidate fails: each is tried exactly once and the last error is reported once', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines({
        mpegts: [new PlaybackError({ kind: 'blocked' })],
        hls: [new PlaybackError({ kind: 'auth' })],
      }),
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    expect(events).toEqual([
      ['attempt', 'mpegts:ts:0'],
      ['fallback', 'blocked->hls'],
      ['attempt', 'hls:hls:1'],
      ['error', 'auth'],
    ]);
    expect(FakeEngine.created.map((e) => e.load.mock.calls.length)).toEqual([1, 1]);
    expect(controller.engine).toBeUndefined();
  });

  it('no fallback: reports the error', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines({ native: [new PlaybackError({ kind: 'unsupported-container' })] }),
    });
    const events = record(controller);
    await controller.play(mp4());
    expect(events).toEqual([
      ['attempt', 'native:mp4:0'],
      ['error', 'unsupported-container'],
    ]);
  });

  it('non-PlaybackError rejections become unknown errors', async () => {
    const engines = fakeEngines();
    engines.native = () => {
      const engine = new FakeEngine('native');
      engine.load.mockRejectedValueOnce(new TypeError('boom'));
      return engine;
    };
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines,
    });
    const errors: PlaybackError[] = [];
    controller.on('error', (e) => errors.push(e));
    await controller.play(mp4());
    expect(errors[0]).toMatchObject({ kind: 'unknown', engine: 'native', detail: 'TypeError' });
  });

  it('Xtream TS on a browser without MSE goes straight to the .m3u8 fallback', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: LEGACY_IOS,
      engines: fakeEngines(),
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    expect(events).toEqual([['attempt', 'native:hls:1']]);
  });

  it('nothing playable: reports unsupported-container without creating an engine', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: LEGACY_IOS,
      engines: fakeEngines(),
    });
    const events = record(controller);
    await controller.play({ url: 'https://a.test/x.avi', kind: 'vod', container: 'avi' });
    expect(events).toEqual([['error', 'unsupported-container']]);
    expect(FakeEngine.created).toHaveLength(0);
  });

  it('errors after stop() are ignored', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines(),
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    const engine = FakeEngine.created[0];
    await controller.stop();
    engine?.fail(new PlaybackError({ kind: 'network' }));
    await flush();
    expect(events).toEqual([['attempt', 'mpegts:ts:0']]);
    expect(engine?.destroy).toHaveBeenCalledTimes(1);
    expect(controller.engine).toBeUndefined();
  });

  it('switching streams destroys the previous engine before the next one loads', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines(),
    });
    await controller.play(ts(1));
    const first = FakeEngine.created[0];
    await controller.play(mp4(2));
    expect(first?.destroy).toHaveBeenCalledTimes(1);
    expect(first?.listeners.size).toBe(0);
    const second = FakeEngine.created[1];
    expect(first?.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      second?.load.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('unsubscribe stops event delivery', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
      engines: fakeEngines(),
    });
    const cb = vi.fn();
    const off = controller.on('attempt', cb);
    off();
    await controller.play(ts());
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('player controller — real engines with mocked hls.js/mpegts.js', () => {
  let urls: ReturnType<typeof stubObjectUrls>;
  beforeEach(() => {
    urls = stubObjectUrls();
  });
  afterEach(() => urls.restore());

  it('rapid zapping: 5 plays in a row → only the last one loads', async () => {
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), { capabilities: CHROME });
    const events = record(controller);
    await Promise.all([1, 2, 3, 4, 5].map((n) => controller.play(m3u8(n))));
    expect(libState.hls).toHaveLength(1);
    expect(libState.hls[0]?.source).toBe(m3u8(5).url);
    expect(events).toEqual([['attempt', 'hls:hls:0']]);
  });

  it('a new play while the previous engine is still downloading its library aborts it', async () => {
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), { capabilities: CHROME });
    const first = controller.play(ts(1)); // mpegts.js import in flight
    await Promise.resolve();
    await Promise.resolve();
    const second = controller.play(m3u8(2));
    await Promise.all([first, second]);
    expect(libState.mpegts).toHaveLength(0);
    expect(libState.hls).toHaveLength(1);
    expect(controller.engine).toBe('hls');
  });

  it('switching hls → mpegts → native → stop leaks nothing', async () => {
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), { capabilities: CHROME });

    await controller.play(m3u8());
    const hls = libState.hls[0];
    expect(hls?.count('hlsError')).toBe(1);

    await controller.play(ts());
    const mpegts = libState.mpegts[0];
    expect(hls?.destroy).toHaveBeenCalledTimes(1);
    expect(hls?.count('hlsError')).toBe(0);
    expect(mpegts?.count('error')).toBe(1);

    await controller.play(mp4());
    expect(mpegts?.destroy).toHaveBeenCalledTimes(1);
    expect(mpegts?.count('error')).toBe(0);
    expect(video.listenerCount('error')).toBe(1);

    await controller.stop();
    expect(video.listenerCount()).toBe(0);
    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(urls.revoke).toHaveBeenCalledTimes(2);
    expect(urls.live.size).toBe(0);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalledTimes(3); // once per destroyed engine
  });

  it('object URLs are revoked even if a library forgets to', async () => {
    libState.leakObjectUrl = true;
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), { capabilities: CHROME });
    await controller.play(m3u8());
    await controller.play(ts());
    await controller.stop();
    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(urls.live.size).toBe(0);
  });

  it('fallback from a failing mpegts stream to hls.js with the real engines', async () => {
    const controller = createPlayerController(new FakeVideo().asElement(), {
      capabilities: CHROME,
    });
    const events = record(controller);
    await controller.play({ ...ts(), fallbacks: [m3u8()] });
    libState.mpegts[0]?.error('MediaError', 'CodecUnsupported');
    await flush();
    expect(events).toEqual([
      ['attempt', 'mpegts:ts:0'],
      ['fallback', 'unsupported-codec->hls'],
      ['attempt', 'hls:hls:1'],
    ]);
    expect(libState.mpegts[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(libState.hls[0]?.source).toBe(m3u8().url);
  });

  it('every URL goes through the injected rewriter', async () => {
    const rewrite = vi.fn(
      (url: string, purpose: string) =>
        `https://proxy.test/${purpose}?u=${encodeURIComponent(url)}`,
    );
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), {
      capabilities: CHROME,
      rewriter: { rewrite },
    });

    await controller.play(mp4());
    expect(video.src).toBe(`https://proxy.test/stream?u=${encodeURIComponent(mp4().url)}`);

    await controller.play(ts());
    expect(libState.mpegts[0]?.dataSource.url).toBe(
      `https://proxy.test/stream?u=${encodeURIComponent(ts().url)}`,
    );

    await controller.play(m3u8());
    const xhrSetup = libState.hls[0]?.config.xhrSetup as (
      x: { open: (...a: unknown[]) => void },
      u: string,
      c: object,
    ) => void;
    const xhr = { open: vi.fn() };
    xhrSetup(xhr, m3u8().url, {});
    expect(xhr.open).toHaveBeenCalledWith(
      'GET',
      `https://proxy.test/playlist?u=${encodeURIComponent(m3u8().url)}`,
      true,
    );
    expect(rewrite.mock.calls.map(([, purpose]) => purpose)).toEqual([
      'stream',
      'stream',
      'playlist',
      'playlist',
    ]);
  });

  it('defaults to the identity rewriter', async () => {
    const video = new FakeVideo();
    const controller = createPlayerController(video.asElement(), { capabilities: CHROME });
    await controller.play(mp4());
    expect(video.src).toBe(mp4().url);
  });
});
