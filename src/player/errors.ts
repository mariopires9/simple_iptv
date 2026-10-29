// Maps hls.js, mpegts.js and HTMLMediaElement failures to PlaybackErrorKind (PLY-01).
// The mappers take plain strings (the libraries' enum values), so they are testable without
// loading either library.
import { PlaybackError } from './types';
import type { EngineId, PlaybackErrorKind } from './types';

export interface ErrorContext {
  engine: EngineId;
  /** Stream URL as requested (after the rewriter); only its shortened form is kept. */
  url: string;
  pageProtocol?: string | undefined;
}

/**
 * Protocol of the app page, or undefined outside a browser.
 * TODO(follow-up, coordinator): core/net has the same private helper (`pageProtocol()` in
 * http.ts); once it is exported from `@/core/net`, use it here and drop this copy. Keep the guard
 * identical until then.
 */
export function currentPageProtocol(): string | undefined {
  const location = (globalThis as { location?: { protocol?: unknown } }).location;
  return typeof location?.protocol === 'string' ? location.protocol : undefined;
}

/** `https:` page requesting an `http:` URL: the browser blocks it (or auto-upgrades media). */
export function isMixedContent(url: string, pageProtocol: string | undefined): boolean {
  return pageProtocol === 'https:' && /^http:/i.test(url);
}

function blockedHint(ctx: ErrorContext): 'mixed-content' | 'cors' {
  return isMixedContent(ctx.url, ctx.pageProtocol) ? 'mixed-content' : 'cors';
}

function make(
  ctx: ErrorContext,
  kind: PlaybackErrorKind,
  detail: string,
  status?: number,
  codec?: string,
): PlaybackError {
  return new PlaybackError({
    kind,
    engine: ctx.engine,
    detail,
    url: ctx.url,
    ...(status !== undefined && status > 0 ? { status } : {}),
    ...(kind === 'blocked' ? { hint: blockedHint(ctx) } : {}),
    ...(codec !== undefined ? { codec } : {}),
  });
}

const MAX_CODEC_LENGTH = 64;

/**
 * The `codecs` parameter of a MIME type found in `text` (a MIME type or a browser error message
 * quoting one), e.g. `video/mp4;codecs="avc1.64001f,mp4a.40.2"` → `avc1.64001f, mp4a.40.2`.
 * Only RFC 6381-like tokens are kept, so nothing else of the text (never a URL) leaks through.
 */
export function parseCodecs(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /codecs\s*=\s*["']?([A-Za-z0-9.+-]+(?:\s*,\s*[A-Za-z0-9.+-]+)*)/i.exec(text);
  const list = match?.[1]
    ?.split(',')
    .map((codec) => codec.trim())
    .filter((codec) => codec !== '')
    .join(', ');
  return list && list.length <= MAX_CODEC_LENGTH ? list : undefined;
}

/** HTTP status of a failed request → kind. Status 0 means the browser refused to expose it. */
function kindForStatus(status: number | undefined): PlaybackErrorKind {
  if (status === 0) return 'blocked';
  if (status === 401 || status === 403) return 'auth';
  return 'network';
}

// --- HTMLMediaElement --------------------------------------------------------------------

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/**
 * Native `<video>` error. `MEDIA_ERR_SRC_NOT_SUPPORTED` is also what browsers report for a 404,
 * a CORS failure or a blocked mixed-content request on the first load, so it can only be told
 * apart from a real format problem for mixed content.
 */
export function mapMediaError(code: number | undefined, ctx: ErrorContext): PlaybackError {
  const detail = (code !== undefined ? MEDIA_ERROR_NAMES[code] : undefined) ?? 'MEDIA_ERR_UNKNOWN';
  switch (code) {
    case 2:
      return make(ctx, 'network', detail);
    case 3:
      return make(ctx, 'decode', detail);
    case 4:
      return make(
        ctx,
        isMixedContent(ctx.url, ctx.pageProtocol) ? 'blocked' : 'unsupported-container',
        detail,
      );
    default:
      return make(ctx, 'unknown', detail);
  }
}

// --- hls.js ------------------------------------------------------------------------------

/** The fields of hls.js `ErrorData` the mapping reads. */
export interface HlsErrorLike {
  type: string;
  details: string;
  fatal: boolean;
  response?: { code?: number } | undefined;
  /** `bufferAddCodecError`: the MIME type (with codecs) the browser refused. */
  mimeType?: string | undefined;
  /** `bufferAddCodecError`: which SourceBuffer could not be created. */
  sourceBufferName?: string | undefined;
}

const HLS_CODEC_DETAILS = new Set([
  'manifestIncompatibleCodecsError',
  'bufferAddCodecError',
  'bufferIncompatibleCodecsError',
]);
const HLS_CONTAINER_DETAILS = new Set([
  'manifestParsingError',
  'levelParsingError',
  'levelEmptyError',
]);

export function mapHlsError(data: HlsErrorLike, ctx: ErrorContext): PlaybackError {
  const { type, details } = data;
  if (HLS_CODEC_DETAILS.has(details)) {
    return make(ctx, 'unsupported-codec', details, undefined, parseCodecs(data.mimeType));
  }
  if (HLS_CONTAINER_DETAILS.has(details)) return make(ctx, 'unsupported-container', details);
  switch (type) {
    case 'networkError': {
      const status = data.response?.code;
      const timeout = /timeout/i.test(details);
      return make(ctx, timeout ? 'network' : kindForStatus(status), details, status);
    }
    case 'mediaError':
    case 'muxError':
      return make(ctx, 'decode', details);
    case 'keySystemError':
      // DRM-protected stream: out of scope (no EME support is configured).
      return make(ctx, 'unsupported-container', details);
    default:
      return make(ctx, 'unknown', details);
  }
}

/**
 * A non-fatal hls.js `bufferAddCodecError`: the browser refused one SourceBuffer and hls.js
 * drops that track, playing the other one only — video without sound (PLY-04 AC3) or sound
 * without picture. Returns which track was refused.
 */
export function hlsRejectedTrack(data: HlsErrorLike): 'audio' | 'video' | undefined {
  if (data.fatal || data.details !== 'bufferAddCodecError') return undefined;
  return data.sourceBufferName === 'audio' || data.sourceBufferName === 'video'
    ? data.sourceBufferName
    : undefined;
}

/** Whether a fatal hls.js error is worth one `recoverMediaError()` attempt. */
export function isRecoverableHlsMediaError(data: HlsErrorLike): boolean {
  return data.type === 'mediaError' && !HLS_CODEC_DETAILS.has(data.details);
}

// --- mpegts.js ---------------------------------------------------------------------------

/** The `errorInfo` argument of mpegts.js `Events.ERROR`. */
export interface MpegtsErrorInfo {
  code?: number;
  msg?: string;
}

/**
 * mpegts.js `Events.ERROR(type, detail, info)`. Values are the library's strings, e.g.
 * `NetworkError` / `HttpStatusCodeInvalid`, `MediaError` / `CodecUnsupported`.
 */
export function mapMpegtsError(
  type: string,
  detail: string,
  info: MpegtsErrorInfo | undefined,
  ctx: ErrorContext,
): PlaybackError {
  switch (detail) {
    case 'HttpStatusCodeInvalid':
      return make(ctx, kindForStatus(info?.code), detail, info?.code);
    case 'Exception':
      // fetch() rejected with a TypeError: CORS, mixed content, DNS or offline.
      return make(ctx, 'blocked', detail);
    case 'ConnectingTimeout':
    case 'UnrecoverableEarlyEof':
      return make(ctx, 'network', detail);
    case 'CodecUnsupported':
      return make(ctx, 'unsupported-codec', detail);
    case 'FormatUnsupported':
    case 'FormatError':
      return make(ctx, 'unsupported-container', detail);
    case 'MediaMSEError': {
      // `addSourceBuffer()` refusing the MIME type: the browser message quotes it, e.g.
      // "The type provided ('audio/mp4;codecs=ac-3') is unsupported."
      const codec = /unsupported|not supported/i.test(info?.msg ?? '')
        ? parseCodecs(info?.msg)
        : undefined;
      return codec !== undefined
        ? make(ctx, 'unsupported-codec', detail, undefined, codec)
        : make(ctx, 'decode', detail);
    }
  }
  if (type === 'NetworkError') return make(ctx, 'network', detail);
  if (type === 'MediaError') return make(ctx, 'decode', detail);
  return make(ctx, 'unknown', detail);
}

/** Name of a thrown value for logs (`TypeError`, `AbortError`…), or its `typeof`. Never the message. */
export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

/** Anything thrown by an engine → PlaybackError (non-PlaybackErrors become `unknown`). */
export function toPlaybackError(e: unknown, ctx: ErrorContext): PlaybackError {
  if (e instanceof PlaybackError) return e;
  const detail = e instanceof Error ? e.name : 'exception';
  return make(ctx, 'unknown', detail);
}
