// Player contracts (PLY-01, docs/ARCHITECTURE.md §4).
import { shortenUrl } from '@/core/net';
import type { UrlRewriter } from '@/core/net';

/**
 * Stream container. `mov` and `avi` extend the indicative contract of ARCHITECTURE §4 so the
 * selection rules of RESEARCH §5.2 (MOV → native, AVI → unsupported) can be expressed.
 */
export type StreamContainer =
  'hls' | 'ts' | 'mp4' | 'mkv' | 'webm' | 'mov' | 'flv' | 'avi' | 'unknown';

export interface StreamDescriptor {
  url: string;
  kind: 'live' | 'vod';
  container: StreamContainer;
  /**
   * Alternatives tried in order, each once, when this descriptor fails or cannot be played here
   * (e.g. the Xtream `.m3u8` variant of a `.ts` live stream). Nested fallbacks are ignored.
   */
  fallbacks?: StreamDescriptor[];
}

export type EngineId = 'native' | 'hls' | 'mpegts';

export type PlaybackErrorKind =
  | 'network'
  | 'blocked' // CORS, mixed content or DNS — the browser does not tell them apart
  | 'unsupported-container'
  | 'unsupported-codec'
  | 'decode'
  | 'auth'
  | 'unknown';

export interface PlaybackErrorInit {
  kind: PlaybackErrorKind;
  engine?: EngineId;
  /** Library/browser error code (e.g. `manifestLoadError`, `MEDIA_ERR_DECODE`); never a URL. */
  detail?: string;
  status?: number;
  hint?: 'mixed-content' | 'cors';
  /**
   * Codec(s) the browser refused, as RFC 6381 strings (e.g. `ac-3`, `avc1.64001f, mp4a.40.2`),
   * when the engine knows them (PLY-04 AC2).
   */
  codec?: string;
  /** Stream URL. Never stored: only the shortened, redacted form (`target`). */
  url?: string;
  /**
   * An already shortened, redacted URL (copying another PlaybackError). Ignored when `url` is
   * given.
   */
  target?: string;
  /** PLY-06: every candidate the play() tried or skipped, in order (final errors only). */
  attempts?: readonly PlaybackAttempt[];
}

/**
 * One candidate of a play() that failed or was skipped (PLY-06), so the error overlay can show
 * why each one failed, not only the last one.
 */
export interface PlaybackAttempt {
  /** `unsupported`: skipped without loading it (nothing can play that container here). */
  engine: EngineId | 'unsupported';
  container: StreamContainer;
  /** hls.js / mpegts.js only: the Media Source API they used. */
  mediaSource?: 'mse' | 'mms';
  /** The failure; its URL is only kept masked (`target`). */
  error: PlaybackError;
}

const DESCRIPTIONS: Record<PlaybackErrorKind, string> = {
  network: 'Network error while playing',
  blocked: 'Stream blocked by the browser',
  'unsupported-container': 'Stream format not supported',
  'unsupported-codec': 'Stream codec not supported',
  decode: 'Stream could not be decoded',
  auth: 'Stream access rejected',
  unknown: 'Playback failed',
};

/** Classified playback failure. The UI maps `kind` (+ `hint`) to a localized message. */
export class PlaybackError extends Error {
  override readonly name = 'PlaybackError';
  readonly kind: PlaybackErrorKind;
  readonly engine?: EngineId;
  readonly detail?: string;
  readonly status?: number;
  readonly hint?: 'mixed-content' | 'cors';
  readonly codec?: string;
  /** Shortened, redacted URL (see `shortenUrl`). */
  readonly target?: string;
  /** PLY-06: every candidate tried or skipped, in order (set on the final error of a play()). */
  readonly attempts?: readonly PlaybackAttempt[];

  constructor(init: PlaybackErrorInit) {
    const { kind, engine, detail, status, hint, codec, url, attempts } = init;
    const target = url !== undefined ? shortenUrl(url) : init.target;
    const extra = [
      engine,
      detail,
      status !== undefined ? `HTTP ${status}` : undefined,
      hint,
      codec !== undefined ? `codec ${codec}` : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(', ');
    super(
      `${DESCRIPTIONS[kind]} (${kind}${extra ? `, ${extra}` : ''})${target ? `: ${target}` : ''}`,
    );
    this.kind = kind;
    if (engine !== undefined) this.engine = engine;
    if (detail !== undefined) this.detail = detail;
    if (status !== undefined) this.status = status;
    if (hint !== undefined) this.hint = hint;
    if (codec !== undefined) this.codec = codec;
    if (target !== undefined) this.target = target;
    if (attempts !== undefined) this.attempts = attempts;
  }
}

/** A copy of `error` carrying the attempts of its play() (PLY-06). */
export function withAttempts(
  error: PlaybackError,
  attempts: readonly PlaybackAttempt[],
): PlaybackError {
  return new PlaybackError({
    kind: error.kind,
    engine: error.engine,
    detail: error.detail,
    status: error.status,
    hint: error.hint,
    codec: error.codec,
    target: error.target,
    attempts,
  });
}

export function isPlaybackError(e: unknown): e is PlaybackError {
  return e instanceof PlaybackError;
}

/** What every engine receives from the controller. */
export interface EngineDeps {
  /** Every URL the engine requests goes through it (ADR-010). */
  rewriter: UrlRewriter;
  /** Protocol of the app page (`https:` in production); used to flag mixed content. */
  pageProtocol?: string;
}

export interface PlayerEngine {
  readonly id: EngineId;
  attach(video: HTMLVideoElement): void;
  /**
   * Starts loading `stream` into the attached element. Resolves once the source is attached
   * (playback itself is started by the caller with `video.play()`); later failures arrive through
   * `on('error')`. Resolves without doing anything if `destroy()` ran in the meantime.
   * `startAt` (seconds) only applies to VOD; it is ignored for `kind: 'live'`.
   */
  load(stream: StreamDescriptor, startAt?: number): Promise<void>;
  /** Idempotent. Removes every listener, releases MediaSource/object URLs and empties the element. */
  destroy(): Promise<void>;
  on<K extends keyof EngineEvents>(evt: K, cb: (payload: EngineEvents[K]) => void): () => void;
  /**
   * PLY-05: the stream's alternative audio and subtitle tracks (empty lists when none). Engines
   * without track support (mpegts.js) omit the three track methods. Changes arrive through
   * `on('tracks')`; switching never reloads the stream.
   */
  tracks?(): MediaTracks;
  selectAudioTrack?(id: string): void;
  /** `undefined` turns subtitles off. */
  selectTextTrack?(id: string | undefined): void;
}

/** One audio or subtitle track as the stream declares it (PLY-05). Untrusted text. */
export interface MediaTrack {
  /** Engine-specific, only meaningful to the engine that listed it. */
  id: string;
  /** Name declared by the stream (e.g. HLS `NAME`); may be empty. */
  label: string;
  /** BCP 47 / ISO 639 language code declared by the stream, if any. */
  language?: string;
}

export interface MediaTracks {
  audio: readonly MediaTrack[];
  /** The active audio track. */
  audioId?: string;
  /** Subtitles and captions. */
  text: readonly MediaTrack[];
  /** The subtitle track shown; undefined = off. */
  textId?: string;
}

export const NO_TRACKS: MediaTracks = { audio: [], text: [] };

/**
 * Non-fatal information about the current playback.
 * - `resume-unsupported`: the requested `startAt` is not seekable (common for MPEG-TS), so
 *   playback starts from the beginning.
 * - `audio-unsupported`: the browser refused the audio track (e.g. AC-3 in Chrome); the video
 *   keeps playing without sound (PLY-04 AC3). `codec` is the RFC 6381 string when known.
 * - `video-unsupported`: the browser refused the video track; only the sound plays.
 * - `no-audio-track`: the engine found no audio track in the stream (so silence is expected and
 *   the "no sound" heuristic must not fire).
 */
export type PlaybackNotice =
  | { type: 'resume-unsupported'; startAt: number }
  | { type: 'audio-unsupported'; codec?: string }
  | { type: 'video-unsupported'; codec?: string }
  | { type: 'no-audio-track' };

export interface EngineEvents {
  error: PlaybackError;
  notice: PlaybackNotice;
  /** PLY-05: the track lists or the active tracks changed. */
  tracks: MediaTracks;
}

export type EngineFactory = (deps: EngineDeps) => PlayerEngine;
