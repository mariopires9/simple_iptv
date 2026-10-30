// Runs the real hls.js (playlist loading and parsing only; jsdom has no MSE) with the rewriting
// loader around a fake "network" that only answers proxy URLs, like a self-hosted proxy would.
import Hls from 'hls.js';
import type { LevelLoadedData, Loader, LoaderContext } from 'hls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxyRewriter, type UrlRewriter } from '@/core/net';
import { createRewritingLoader, hlsRequestPurpose } from './hlsLoader';
import type { LoaderConstructor } from './hlsLoader';

const MASTER = 'https://cdn.test/live/master.m3u8';
const ORIGIN: Record<string, string> = {
  [MASTER]:
    '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2"\n' +
    'v1/index.m3u8\n',
  'https://cdn.test/live/v1/index.m3u8':
    '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n' +
    '#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1"\n' +
    '#EXTINF:6.0,\nseg0.ts\n#EXTINF:6.0,\n/abs/seg1.ts\n#EXT-X-ENDLIST\n',
};

const PROXY = 'https://proxy.test/';
const proxied = (url: string) => `${PROXY}?u=${encodeURIComponent(url)}`;

const newStats = () => ({
  aborted: false,
  loaded: 0,
  retry: 0,
  total: 0,
  chunkCount: 0,
  bwEstimate: 0,
  loading: { start: 0, first: 0, end: 0 },
  parsing: { start: 0, end: 0 },
  buffering: { start: 0, first: 0, end: 0 },
});

/** "Network": answers only proxy URLs; the response URL is the proxy URL (like xhr.responseURL). */
function proxyNetwork(requests: string[]): LoaderConstructor {
  return class ProxyOnlyLoader {
    context: LoaderContext | null = null;
    stats = newStats();
    load(
      context: LoaderContext,
      _config: unknown,
      callbacks: Parameters<Loader<LoaderContext>['load']>[2],
    ) {
      this.context = context;
      requests.push(context.url);
      const url = new URL(context.url);
      const original = url.origin + url.pathname === PROXY ? url.searchParams.get('u') : null;
      const body = original !== null ? ORIGIN[original] : undefined;
      setTimeout(() => {
        if (body === undefined) {
          callbacks.onError({ code: 404, text: 'Not Found' }, context, null, this.stats);
        } else {
          callbacks.onSuccess(
            { url: context.url, data: body, code: 200 },
            this.stats,
            context,
            null,
          );
        }
      }, 0);
    }
    abort() {}
    destroy() {}
  } as unknown as LoaderConstructor;
}

let hls: Hls | undefined;
beforeEach(() => {
  // jsdom has no MediaSource; hls.js only needs isTypeSupported to accept the level's codecs.
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
});
afterEach(() => {
  hls?.destroy();
  hls = undefined;
  vi.unstubAllGlobals();
});

describe('createRewritingLoader with real hls.js', () => {
  it('master + media playlist with relative URIs: each request is proxy?u=<original absolute>, once', async () => {
    const requests: string[] = [];
    const rewrite = vi.fn((url: string) => proxied(url));
    const rewriter: UrlRewriter = { rewrite };
    hls = new Hls({
      debug: false,
      enableWorker: false,
      loader: createRewritingLoader(proxyNetwork(requests), rewriter),
    });

    const levelLoaded = new Promise<LevelLoadedData>((resolve, reject) => {
      hls?.on(Hls.Events.LEVEL_LOADED, (_e, data) => resolve(data));
      hls?.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reject(new Error(data.details));
      });
    });
    hls.loadSource(MASTER);
    hls.startLoad();
    const level = await levelLoaded;

    expect(requests).toEqual([proxied(MASTER), proxied('https://cdn.test/live/v1/index.m3u8')]);
    expect(rewrite.mock.calls.map(([url]) => url)).toEqual([
      MASTER,
      'https://cdn.test/live/v1/index.m3u8',
    ]);
    // Segment and key URIs resolve against the original media playlist URL, not the proxy.
    const fragments = level.details.fragments;
    expect(fragments.map((f) => f.url)).toEqual([
      'https://cdn.test/live/v1/seg0.ts',
      'https://cdn.test/abs/seg1.ts',
    ]);
    expect(fragments[0]?.decryptdata?.uri).toBe('https://cdn.test/live/keys/k1');
  });

  it('identity rewriter: requests and responses (redirects included) pass through untouched', () => {
    const calls: Array<{ url: string; responseUrl?: string }> = [];
    const Base = class {
      context = null;
      stats = newStats();
      load(context: LoaderContext, _c: unknown, cb: Parameters<Loader<LoaderContext>['load']>[2]) {
        calls.push({ url: context.url });
        cb.onSuccess(
          { url: 'https://node7.test/redirected.m3u8', data: '' },
          this.stats,
          context,
          null,
        );
      }
      abort() {}
      destroy() {}
    } as unknown as LoaderConstructor;
    const Loader = createRewritingLoader(Base, { rewrite: (u) => u });
    const onSuccess = vi.fn();
    const context = { url: MASTER, type: 'manifest', responseType: 'text' } as LoaderContext;
    new Loader(Hls.DefaultConfig).load(context, {} as never, {
      onSuccess,
      onError: vi.fn(),
      onTimeout: vi.fn(),
    });
    expect(calls).toEqual([{ url: MASTER }]);
    expect(onSuccess.mock.calls[0]?.[0].url).toBe('https://node7.test/redirected.m3u8');
    expect(onSuccess.mock.calls[0]?.[2]).toBe(context);
  });

  it('reports the original context to every callback and leaves it unmodified', () => {
    const seen: LoaderContext[] = [];
    const Base = class {
      context = null;
      stats = newStats();
      load(context: LoaderContext, _c: unknown, cb: Parameters<Loader<LoaderContext>['load']>[2]) {
        seen.push(context);
        cb.onError({ code: 500, text: 'x' }, context, null, this.stats);
        cb.onTimeout(this.stats, context, null);
        cb.onAbort?.(this.stats, context, null);
        cb.onProgress?.(this.stats, context, '', null);
      }
      abort() {}
      destroy() {}
    } as unknown as LoaderConstructor;
    const Loader = createRewritingLoader(Base, { rewrite: proxied });
    const context = {
      url: 'https://cdn.test/seg.ts',
      type: 'media-fragment',
      responseType: 'arraybuffer',
    } as LoaderContext;
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onTimeout: vi.fn(),
      onAbort: vi.fn(),
      onProgress: vi.fn(),
    };
    new Loader(Hls.DefaultConfig).load(context, {} as never, callbacks);
    expect(seen[0]?.url).toBe(proxied('https://cdn.test/seg.ts'));
    expect(context.url).toBe('https://cdn.test/seg.ts');
    for (const cb of [
      callbacks.onError,
      callbacks.onTimeout,
      callbacks.onAbort,
      callbacks.onProgress,
    ]) {
      expect(cb.mock.calls[0]).toContain(context);
    }
  });

  it('purpose by context type: fragments are streams; playlists and keys are playlists', () => {
    const ctx = (type: string, extra: object = {}) =>
      ({ url: 'x', responseType: '', type, ...extra }) as unknown as LoaderContext;
    expect(hlsRequestPurpose(ctx('media-fragment', { frag: {} }))).toBe('stream');
    // A key context also carries `frag`: the type decides, not the presence of `frag`.
    expect(hlsRequestPurpose(ctx('key', { frag: {}, keyInfo: {} }))).toBe('playlist');
    for (const type of ['manifest', 'level', 'audioTrack', 'subtitleTrack', 'steering-manifest']) {
      expect(hlsRequestPurpose(ctx(type))).toBe('playlist');
    }
  });

  it('personal proxy (PRX-01): absolute proxy child URLs are not wrapped twice; the original URL is reported', async () => {
    // The proxy rewrites playlists so that their URIs are absolute proxy URLs (B/v1/…).
    const base = 'https://pc.example.test/relay';
    const token = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
    const rewriter = createProxyRewriter({
      baseUrl: base,
      token,
      purposes: ['stream', 'playlist'],
    });
    const upstreamMaster = 'http://edge.example.test/live/master.m3u8';
    const proxiedMaster = rewriter.rewrite(upstreamMaster, 'playlist');
    const childMedia = `${base}/v1/${token}/u/aHR0cDovL2VkZ2UuZXhhbXBsZS50ZXN0L2xpdmUvdjEubTN1OA/v1.m3u8`;
    const childSegment = `${base}/v1/${token}/u/aHR0cDovL2VkZ2UuZXhhbXBsZS50ZXN0L2xpdmUvczAudHM/s0.ts`;
    const bodies: Record<string, string> = {
      [proxiedMaster]:
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2"\n' +
        `${childMedia}\n`,
      [childMedia]:
        '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n' +
        `#EXTINF:6.0,\n${childSegment}\n#EXT-X-ENDLIST\n`,
    };
    const requests: string[] = [];
    const responseUrls: string[] = [];
    const Network = class {
      context: LoaderContext | null = null;
      stats = newStats();
      load(context: LoaderContext, _c: unknown, cb: Parameters<Loader<LoaderContext>['load']>[2]) {
        requests.push(context.url);
        const body = bodies[context.url];
        setTimeout(() => {
          if (body === undefined)
            cb.onError({ code: 404, text: 'Not Found' }, context, null, this.stats);
          else cb.onSuccess({ url: context.url, data: body, code: 200 }, this.stats, context, null);
        }, 0);
      }
      abort() {}
      destroy() {}
    } as unknown as LoaderConstructor;
    const Wrapped = createRewritingLoader(Network, rewriter);
    const Reporting = class extends (Wrapped as unknown as new (
      c: unknown,
    ) => Loader<LoaderContext>) {
      override load(
        context: LoaderContext,
        config: Parameters<Loader<LoaderContext>['load']>[1],
        callbacks: Parameters<Loader<LoaderContext>['load']>[2],
      ) {
        super.load(context, config, {
          ...callbacks,
          onSuccess: (response, stats, ctx, details) => {
            responseUrls.push(response.url);
            callbacks.onSuccess(response, stats, ctx, details);
          },
        });
      }
    } as unknown as LoaderConstructor;
    hls = new Hls({ debug: false, enableWorker: false, loader: Reporting });
    const levelLoaded = new Promise<LevelLoadedData>((resolve, reject) => {
      hls?.on(Hls.Events.LEVEL_LOADED, (_e, data) => resolve(data));
      hls?.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reject(new Error(data.details));
      });
    });
    hls.loadSource(upstreamMaster);
    hls.startLoad();
    const level = await levelLoaded;

    expect(requests).toEqual([proxiedMaster, childMedia]);
    // The rewritten request reports the upstream URL; the proxy child passes through as is.
    expect(responseUrls).toEqual([upstreamMaster, childMedia]);
    expect(level.details.fragments.map((f) => f.url)).toEqual([childSegment]);
    expect(rewriter.rewrite(childSegment, 'stream')).toBe(childSegment);
  });
});
