// mpegts.js engine (PLY-01): live MPEG-TS and FLV over MSE/ManagedMediaSource.
// mpegts.js is only downloaded on the first load() (ADR-005).
import type Mpegts from 'mpegts.js';
import { log } from '@/core/log';
import { errorName, mapMpegtsError, toPlaybackError } from '../errors';
import type { MpegtsErrorInfo } from '../errors';
import { PlaybackError } from '../types';
import type { EngineDeps, PlayerEngine, StreamDescriptor } from '../types';
import {
  createEngineEmitter,
  requireVideo,
  resetMediaElement,
  resumePosition,
  seekWhenReady,
} from './shared';

type MpegtsStatic = typeof Mpegts;

/**
 * mpegts.js settings (1.8):
 * - `enableWorker: false`: the worker is CSP-compatible (`blob:` URL, no eval), but it is built
 *   at runtime by serializing webpack module functions (`webworkify-webpack`) from the published
 *   bundle, which our bundler re-minifies; until that is verified in a real browser (QA-02) the
 *   main-thread transmuxer is used. Transmuxing a single SD/HD TS stream on the main thread is
 *   the library default.
 * - Live: `isLive`, no latency chasing (it causes audible rate changes), `autoCleanupSourceBuffer`
 *   so long sessions do not grow the SourceBuffer without bound.
 * - VOD: `lazyLoad` (the library default) pauses the download when enough is buffered.
 * - `reuseRedirectedURL`: Xtream streams redirect (302) to a node; reconnects go straight there.
 */
export function mpegtsConfig(isLive: boolean): Mpegts.Config {
  return {
    enableWorker: false,
    isLive,
    liveBufferLatencyChasing: false,
    liveSync: false,
    lazyLoad: !isLive,
    autoCleanupSourceBuffer: true,
    reuseRedirectedURL: true,
  };
}

let loggingConfigured = false;

/** mpegts.js logs to the console, URLs included: silence it and forward warnings, redacted. */
function configureLogging(mpegts: MpegtsStatic): void {
  if (loggingConfigured) return;
  loggingConfigured = true;
  mpegts.LoggingControl.enableAll = false;
  mpegts.LoggingControl.addLogListener((level: unknown, message: unknown) => {
    if (level === 'error' || level === 'warn') log.warn(`mpegts: ${String(message)}`);
  });
}

/** Test hook: lets each test observe the one-time logging setup. */
export function resetMpegtsLoggingForTests(): void {
  loggingConfigured = false;
}

export function createMpegtsEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const events = createEngineEmitter();
  let video: HTMLVideoElement | undefined;
  let player: Mpegts.Player | undefined;
  let detachListeners: (() => void) | undefined;
  let destroyed = false;

  return {
    id: 'mpegts',

    attach(element) {
      video = element;
    },

    async load(stream: StreamDescriptor, startAt?: number) {
      if (destroyed) return;
      const el = requireVideo(video, 'mpegts');
      const mod = await import('mpegts.js');
      if (destroyed) return; // superseded while the chunk was downloading
      // The package is CommonJS: depending on interop the API is the default export or the module.
      const mpegts: MpegtsStatic =
        (mod as { default?: MpegtsStatic }).default ?? (mod as unknown as MpegtsStatic);
      configureLogging(mpegts);

      // mpegts.js fetches a single URL (and follows redirects itself): rewrite it once.
      const url = rewriter.rewrite(stream.url, 'stream');
      const ctx = { engine: 'mpegts' as const, url, pageProtocol };
      if (!mpegts.isSupported()) {
        throw new PlaybackError({
          ...ctx,
          kind: 'unsupported-container',
          detail: 'mseUnsupported',
        });
      }

      const isLive = stream.kind === 'live';
      const instance = mpegts.createPlayer(
        { type: stream.container === 'flv' ? 'flv' : 'mpegts', isLive, url },
        mpegtsConfig(isLive),
      );
      player = instance;

      const onError = (type: string, detail: string, info?: MpegtsErrorInfo) =>
        events.emit('error', mapMpegtsError(type, detail, info, ctx));
      instance.on(mpegts.Events.ERROR, onError);
      // A stream without an audio track is silent on purpose (no "no sound" warning).
      const onMediaInfo = (info?: { hasAudio?: boolean; hasVideo?: boolean }) => {
        if (info?.hasAudio === false && info.hasVideo !== false) {
          events.emit('notice', { type: 'no-audio-track' });
        }
      };
      instance.on(mpegts.Events.MEDIA_INFO, onMediaInfo);
      // VOD resume: seek once the element knows what is seekable. MPEG-TS without an index is
      // often not seekable at all; then playback starts from the beginning and a
      // `resume-unsupported` notice is emitted.
      const resume = resumePosition(stream, startAt);
      const stopSeek =
        resume !== undefined
          ? seekWhenReady(el, resume, events, (time) => {
              instance.currentTime = time;
            })
          : undefined;
      detachListeners = () => {
        instance.off(mpegts.Events.ERROR, onError);
        instance.off(mpegts.Events.MEDIA_INFO, onMediaInfo);
        stopSeek?.();
      };

      try {
        instance.attachMediaElement(el);
        instance.load();
      } catch (e) {
        throw toPlaybackError(e, ctx);
      }
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      detachListeners?.();
      detachListeners = undefined;
      events.clear();
      const instance = player;
      player = undefined;
      if (instance) {
        // destroy() unloads (aborts the fetch), shuts the MediaSource down, revokes its object URL
        // and detaches the element.
        try {
          instance.destroy();
        } catch (e) {
          log.warn('mpegts: destroy failed', { error: errorName(e) });
        }
      }
      if (video) resetMediaElement(video);
      video = undefined;
    },

    on(evt, cb) {
      return events.on(evt, cb);
    },
  };
}
