// Streaming download of an M3U list into the parser (SRC-05 AC1). Runs inside the data worker.
//
// Built on core/net `fetchStream`: the body is never accumulated (each chunk is decoded and parsed
// as it arrives), the timeout is an *inactivity* timeout, network failures are `NetError`s with
// the shared classification, and the raw URL is never logged (only `shortenUrl`). An exception
// thrown by the parser or the callbacks is not a network failure: it reaches the caller unchanged
// (the sync reports it as `internal`).
import { fetchStream, type FetchImpl, type UrlRewriter } from '@/core/net';
import type { M3uParser } from './parser';

/** Default inactivity timeout: no byte for this long → `timeout`. */
export const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export interface DownloadOptions {
  signal: AbortSignal;
  inactivityTimeoutMs?: number;
  fetchImpl?: FetchImpl;
  rewriter?: UrlRewriter;
  /**
   * Cumulative bytes read and the expected size: `Content-Length` only when the body is not
   * content-encoded, and never smaller than what was already read (else `undefined`).
   */
  onBytes?: (bytes: number, total: number | undefined) => void;
  /** After each parsed chunk; return `false` to stop the download early. */
  onChunk?: () => boolean | void;
}

export interface DownloadResult {
  bytes: number;
  /** `false` when `onChunk` stopped the download before the end. */
  completed: boolean;
}

/**
 * GETs `url` and streams the body into `parser`. Resolves when the body was read to the end (and
 * the parser ended) or `onChunk` stopped it; rejects with a `NetError` (`aborted` when `signal`
 * fired) or, for a non-network exception, with that exception.
 */
export function downloadM3u(
  url: string,
  parser: M3uParser,
  options: DownloadOptions,
): Promise<DownloadResult> {
  return fetchStream(
    url,
    async (body) => {
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const chunk = await body.read();
        if (chunk === undefined) break;
        parser.write(decoder.decode(chunk, { stream: true }));
        const total = body.total !== undefined && body.total >= body.bytes ? body.total : undefined;
        options.onBytes?.(body.bytes, total);
        if (options.onChunk?.() === false) return { bytes: body.bytes, completed: false };
      }
      parser.write(decoder.decode());
      parser.end();
      return { bytes: body.bytes, completed: true };
    },
    {
      signal: options.signal,
      purpose: 'playlist',
      inactivityTimeoutMs: options.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.rewriter ? { rewriter: options.rewriter } : {}),
    },
  );
}
