// hls.js engine (PLY-01). hls.js is only downloaded on the first load() (ADR-005).
import type Hls from 'hls.js';
import type { ErrorData, HlsConfig, LoaderContext } from 'hls.js';
import { log } from '@/core/log';
import { shortenUrl } from '@/core/net';
import { isRecoverableHlsMediaError, mapHlsError, toPlaybackError } from '../errors';
import { PlaybackError } from '../types';
import type { EngineDeps, PlayerEngine, StreamDescriptor } from '../types';
import { createErrorEmitter, requireVideo, resetMediaElement } from './shared';

/**
 * hls.js settings (1.7):
 * - `enableWorker`: transmuxing off the main thread. The worker is started from a `blob:` URL
 *   (allowed by `worker-src 'self' blob:`); hls.js does not need `unsafe-eval`.
 * - `lowLatencyMode: false`: IPTV panels do not serve LL-HLS; the extra playlist reloads only cost.
 * - Live: start 3 target durations from the live edge and jump back if more than 10 behind
 *   (e.g. after a stall), without speeding up playback (`maxLiveSyncPlaybackRate: 1`).
 * - `backBufferLength: 30`: bounds memory on long live sessions (default is unbounded).
 */
export const HLS_CONFIG: Partial<HlsConfig> = {
  debug: false,
  enableWorker: true,
  lowLatencyMode: false,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 10,
  maxLiveSyncPlaybackRate: 1,
  backBufferLength: 30,
};

function isFragmentRequest(context: LoaderContext): boolean {
  return 'frag' in context;
}

export function createHlsEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const errors = createErrorEmitter();
  let video: HTMLVideoElement | undefined;
  let hls: Hls | undefined;
  let detachError: (() => void) | undefined;
  let destroyed = false;

  return {
    id: 'hls',

    attach(element) {
      video = element;
    },

    async load(stream: StreamDescriptor, startAt?: number) {
      if (destroyed) return;
      const el = requireVideo(video, 'hls');
      const { default: HlsClass } = await import('hls.js');
      if (destroyed) return; // superseded while the chunk was downloading
      // Errors are classified against the URL actually requested (mixed content depends on it).
      const ctx = {
        engine: 'hls' as const,
        url: rewriter.rewrite(stream.url, 'playlist'),
        pageProtocol,
      };
      if (!HlsClass.isSupported()) {
        throw new PlaybackError({
          ...ctx,
          kind: 'unsupported-container',
          detail: 'mseUnsupported',
        });
      }

      const instance = new HlsClass({
        ...HLS_CONFIG,
        startPosition: startAt !== undefined && startAt > 0 ? startAt : -1,
        // Every request (playlists, keys, segments) goes through the rewriter. Relative URIs are
        // resolved by hls.js against the original playlist URL, so each URL is rewritten once.
        xhrSetup: (xhr, url, context) => {
          xhr.open(
            'GET',
            rewriter.rewrite(url, isFragmentRequest(context) ? 'stream' : 'playlist'),
            true,
          );
        },
      });
      hls = instance;

      let recovered = false;
      const onError = (_event: string, data: ErrorData) => {
        if (!data.fatal) {
          log.debug('hls: non-fatal error', { details: data.details, url: shortenUrl(stream.url) });
          return;
        }
        if (!recovered && isRecoverableHlsMediaError(data)) {
          recovered = true;
          log.warn('hls: fatal media error, trying to recover', { details: data.details });
          instance.recoverMediaError();
          return;
        }
        errors.emit(mapHlsError(data, ctx));
      };
      instance.on(HlsClass.Events.ERROR, onError);
      detachError = () => instance.off(HlsClass.Events.ERROR, onError);

      try {
        instance.attachMedia(el);
        instance.loadSource(stream.url);
      } catch (e) {
        throw toPlaybackError(e, ctx);
      }
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      detachError?.();
      detachError = undefined;
      errors.clear();
      try {
        // Detaches the media (removes the MediaSource, revokes its object URL) and stops loading.
        hls?.destroy();
      } catch (e) {
        log.warn('hls: destroy failed', { error: e instanceof Error ? e.name : 'unknown' });
      }
      hls = undefined;
      if (video) resetMediaElement(video);
      video = undefined;
    },

    on(_evt, cb) {
      return errors.on(cb);
    },
  };
}
