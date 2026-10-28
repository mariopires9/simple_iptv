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
  /** Stream URL. Never stored: only the shortened, redacted form (`target`). */
  url?: string;
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
  /** Shortened, redacted URL (see `shortenUrl`). */
  readonly target?: string;

  constructor({ kind, engine, detail, status, hint, url }: PlaybackErrorInit) {
    const target = url !== undefined ? shortenUrl(url) : undefined;
    const extra = [engine, detail, status !== undefined ? `HTTP ${status}` : undefined, hint]
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
    if (target !== undefined) this.target = target;
  }
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
   */
  load(stream: StreamDescriptor, startAt?: number): Promise<void>;
  /** Idempotent. Removes every listener, releases MediaSource/object URLs and empties the element. */
  destroy(): Promise<void>;
  on(evt: 'error', cb: (e: PlaybackError) => void): () => void;
}

export type EngineFactory = (deps: EngineDeps) => PlayerEngine;
