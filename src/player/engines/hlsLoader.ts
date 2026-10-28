// hls.js loader that routes every request through the UrlRewriter (PLY-01 AC5, ADR-010).
//
// hls.js resolves the relative URIs of a playlist against the playlist's *response* URL
// (`response.url`, i.e. `xhr.responseURL`, falling back to `context.url`). Rewriting in
// `xhrSetup` would make that the proxy URL, so `seg1.ts` would resolve to `https://proxy/seg1.ts`.
// This wrapper instead hands the inner (default) loader a copy of the context with the rewritten
// URL and reports the original context — and, when the URL was rewritten, the original URL as the
// response URL — back to hls.js. Each request is therefore rewritten exactly once, and relative
// URIs resolve against the original playlist URL.
// With the identity rewriter the response is passed through untouched, so redirects (Xtream
// streams redirect to another host) still drive relative URI resolution.
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from 'hls.js';
import type { RequestPurpose, UrlRewriter } from '@/core/net';

export type LoaderConstructor = new (config: HlsConfig) => Loader<LoaderContext>;

/**
 * Purpose of an hls.js request, by its context type (`LoaderContextType`): media fragments
 * (`media-fragment`, which also covers subtitle segments) are `stream`; playlists, keys
 * (`key`), steering manifests and other small documents are `playlist`.
 */
export function hlsRequestPurpose(context: LoaderContext): RequestPurpose {
  return (context.type as string) === 'media-fragment' ? 'stream' : 'playlist';
}

export function createRewritingLoader(
  Base: LoaderConstructor,
  rewriter: UrlRewriter,
): LoaderConstructor {
  return class RewritingLoader implements Loader<LoaderContext> {
    private readonly inner: Loader<LoaderContext>;
    context: LoaderContext | null = null;

    constructor(config: HlsConfig) {
      this.inner = new Base(config);
      // hls.js reads optional capabilities straight off the loader instance.
      if (this.inner.getCacheAge) this.getCacheAge = () => this.inner.getCacheAge?.() ?? null;
      if (this.inner.getResponseHeader) {
        this.getResponseHeader = (name) => this.inner.getResponseHeader?.(name) ?? null;
      }
    }

    getCacheAge?: () => number | null;
    getResponseHeader?: (name: string) => string | null;

    get stats(): LoaderStats {
      return this.inner.stats;
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.context = context;
      const original = context.url;
      const target = rewriter.rewrite(original, hlsRequestPurpose(context));
      const rewritten = target !== original;
      const request: LoaderContext = rewritten ? { ...context, url: target } : context;
      const { onAbort, onProgress } = callbacks;

      this.inner.load(request, config, {
        onSuccess: (response, stats, _ctx, details) =>
          callbacks.onSuccess(
            rewritten ? { ...response, url: original } : response,
            stats,
            context,
            details,
          ),
        onError: (error, _ctx, details, stats) => callbacks.onError(error, context, details, stats),
        onTimeout: (stats, _ctx, details) => callbacks.onTimeout(stats, context, details),
        ...(onAbort ? { onAbort: (stats, _ctx, details) => onAbort(stats, context, details) } : {}),
        ...(onProgress
          ? {
              onProgress: (stats, _ctx, data, details) => onProgress(stats, context, data, details),
            }
          : {}),
      });
    }

    abort(): void {
      this.inner.abort();
    }

    destroy(): void {
      this.inner.destroy();
      this.context = null;
    }
  };
}
