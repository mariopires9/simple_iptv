// hls.js engine (PLY-01). hls.js is only downloaded on the first load() (ADR-005).
import type Hls from 'hls.js';
import type { BufferCodecsData, ErrorData, HlsConfig } from 'hls.js';
import { log } from '@/core/log';
import { shortenUrl } from '@/core/net';
import {
  errorName,
  hlsRejectedTrack,
  isRecoverableHlsMediaError,
  parseCodecs,
  mapHlsError,
  toPlaybackError,
} from '../errors';
import { NO_TRACKS, PlaybackError } from '../types';
import type { EngineDeps, MediaTracks, PlayerEngine, StreamDescriptor } from '../types';
import { createRewritingLoader } from './hlsLoader';
import type { LoaderConstructor } from './hlsLoader';
import {
  createEngineEmitter,
  requireVideo,
  resetMediaElement,
  resumePosition,
  toMediaTrack,
} from './shared';

/**
 * hls.js settings (1.7):
 * - `enableWorker`: transmuxing off the main thread. The worker is started from a `blob:` URL
 *   (allowed by `worker-src 'self' blob:`); hls.js does not need `unsafe-eval`.
 * - `lowLatencyMode: false`: IPTV panels do not serve LL-HLS; the extra playlist reloads only cost.
 * - Live: start 3 target durations from the live edge and jump back if more than 10 behind
 *   (e.g. after a stall), without speeding up playback (`maxLiveSyncPlaybackRate: 1`).
 * - `backBufferLength: 30`: bounds memory on long live sessions (default is unbounded).
 * - `loader`: set per instance to {@link createRewritingLoader} around the default loader.
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

export interface RecoveryPolicy {
  /** A fatal media error happened: `true` if `recoverMediaError()` should be tried. */
  shouldRecover(): boolean;
  /** Playback made progress (a fragment was buffered): the last recovery worked. */
  healthy(): void;
}

/**
 * At most `max` recoveries per `windowMs`, and never twice in a row without progress in between
 * (a recovery that did not lead to a buffered fragment did not work; looping would only stall).
 */
export function createRecoveryPolicy(
  max = 3,
  windowMs = 60_000,
  now: () => number = Date.now,
): RecoveryPolicy {
  const attempts: number[] = [];
  let pending = false;
  return {
    shouldRecover() {
      if (pending) return false;
      const t = now();
      while (attempts.length > 0 && t - (attempts[0] ?? 0) >= windowMs) attempts.shift();
      if (attempts.length >= max) return false;
      attempts.push(t);
      pending = true;
      return true;
    },
    healthy() {
      pending = false;
    },
  };
}

export function createHlsEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const events = createEngineEmitter();
  let video: HTMLVideoElement | undefined;
  let hls: Hls | undefined;
  let detachListeners: (() => void) | undefined;
  let destroyed = false;

  /** PLY-05: hls.js' alternate audio renditions and subtitle tracks; ids are list indexes. */
  const readTracks = (): MediaTracks => {
    if (!hls) return NO_TRACKS;
    const audioIndex = hls.audioTrack;
    const textIndex = hls.subtitleTrack;
    return {
      audio: hls.audioTracks.map((track, i) => toMediaTrack(String(i), track.name, track.lang)),
      text: hls.subtitleTracks.map((track, i) => toMediaTrack(String(i), track.name, track.lang)),
      ...(audioIndex >= 0 ? { audioId: String(audioIndex) } : {}),
      ...(textIndex >= 0 ? { textId: String(textIndex) } : {}),
    };
  };

  return {
    id: 'hls',

    tracks: readTracks,

    selectAudioTrack(id) {
      const index = Number(id);
      if (hls && Number.isInteger(index) && index >= 0 && index < hls.audioTracks.length) {
        hls.audioTrack = index; // switches the rendition in place, without reloading
      }
    },

    selectTextTrack(id) {
      if (!hls) return;
      const index = id === undefined ? -1 : Number(id);
      if (!Number.isInteger(index) || index < -1 || index >= hls.subtitleTracks.length) return;
      hls.subtitleDisplay = index >= 0;
      hls.subtitleTrack = index;
    },

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

      const resume = resumePosition(stream, startAt);
      const instance = new HlsClass({
        ...HLS_CONFIG,
        startPosition: resume ?? -1,
        // Every request (playlists, keys, segments) goes through the rewriter, exactly once,
        // while relative URIs keep resolving against the original URLs (see hlsLoader.ts).
        loader: createRewritingLoader(HlsClass.DefaultConfig.loader as LoaderConstructor, rewriter),
      });
      hls = instance;

      const recovery = createRecoveryPolicy();
      const onError = (_event: string, data: ErrorData) => {
        const rejected = hlsRejectedTrack(data);
        if (rejected) {
          const codec = parseCodecs(data.mimeType);
          log.warn('hls: codec not supported, dropping the track', { track: rejected, codec });
          events.emit('notice', {
            type: rejected === 'audio' ? 'audio-unsupported' : 'video-unsupported',
            ...(codec !== undefined ? { codec } : {}),
          });
          return;
        }
        if (!data.fatal) {
          log.debug('hls: non-fatal error', { details: data.details, url: shortenUrl(stream.url) });
          return;
        }
        if (isRecoverableHlsMediaError(data) && recovery.shouldRecover()) {
          log.warn('hls: fatal media error, trying to recover', { details: data.details });
          instance.recoverMediaError();
          return;
        }
        events.emit('error', mapHlsError(data, ctx));
      };
      const onFragBuffered = () => recovery.healthy();
      // The demuxed tracks of the first fragment: a stream without audio is silent on purpose.
      const onBufferCodecs = (_event: string, data: BufferCodecsData) => {
        if (data.video && !data.audio && !data.audiovideo) {
          events.emit('notice', { type: 'no-audio-track' });
        }
      };
      const onTracks = () => events.emit('tracks', readTracks());
      const TRACK_EVENTS = [
        HlsClass.Events.AUDIO_TRACKS_UPDATED,
        HlsClass.Events.AUDIO_TRACK_SWITCHED,
        HlsClass.Events.SUBTITLE_TRACKS_UPDATED,
        HlsClass.Events.SUBTITLE_TRACK_SWITCH,
      ] as const;
      instance.on(HlsClass.Events.ERROR, onError);
      instance.on(HlsClass.Events.FRAG_BUFFERED, onFragBuffered);
      instance.on(HlsClass.Events.BUFFER_CODECS, onBufferCodecs);
      for (const evt of TRACK_EVENTS) instance.on(evt, onTracks);
      detachListeners = () => {
        instance.off(HlsClass.Events.ERROR, onError);
        instance.off(HlsClass.Events.FRAG_BUFFERED, onFragBuffered);
        instance.off(HlsClass.Events.BUFFER_CODECS, onBufferCodecs);
        for (const evt of TRACK_EVENTS) instance.off(evt, onTracks);
      };

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
      detachListeners?.();
      detachListeners = undefined;
      events.clear();
      try {
        // Detaches the media (removes the MediaSource, revokes its object URL) and stops loading.
        hls?.destroy();
      } catch (e) {
        log.warn('hls: destroy failed', { error: errorName(e) });
      }
      hls = undefined;
      if (video) resetMediaElement(video);
      video = undefined;
    },

    on(evt, cb) {
      return events.on(evt, cb);
    },
  };
}
