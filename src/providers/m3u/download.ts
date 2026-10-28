// Streaming download of an M3U list into the parser (SRC-05 AC1). Runs inside the data worker.
//
// Unlike `fetchText` (core/net), the body is never accumulated: each chunk is decoded and parsed as
// it arrives. The timeout is an *inactivity* timeout (re-armed on every chunk), because a large
// list on a slow link may legitimately take minutes while still making progress.
//
// Every failure becomes a `NetError` with the same classification rules as core/net `request`
// (CORS / mixed content / DNS all surface as a `TypeError` from `fetch`). The raw URL is never
// logged: only `shortenUrl` (via `NetError.target`).
// TODO(core/net): move this into core/net as `fetchStream` when that module is next opened (this
// story may not edit core/net).
import { NetError, type FetchImpl, type NetErrorHint, type UrlRewriter } from '@/core/net';
import { feedM3uStream, type M3uParser } from './parser';

/** Default inactivity timeout: no byte for this long → `timeout`. */
export const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export interface DownloadOptions {
  signal: AbortSignal;
  inactivityTimeoutMs?: number;
  fetchImpl?: FetchImpl;
  rewriter?: UrlRewriter;
  /** Cumulative bytes read and the announced length (`Content-Length`, when known). */
  onBytes?: (bytes: number, total: number | undefined) => void;
  /** After each parsed chunk; return `false` to stop the download early. */
  onChunk?: () => boolean | void;
}

export interface DownloadResult {
  bytes: number;
  /** `false` when `onChunk` stopped the download before the end. */
  completed: boolean;
}

function pageProtocol(): string | undefined {
  const location = (globalThis as { location?: { protocol?: unknown } }).location;
  return typeof location?.protocol === 'string' ? location.protocol : undefined;
}

function isOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  return nav?.onLine === false;
}

function blockedHint(url: string): NetErrorHint {
  let protocol: string | undefined;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = undefined;
  }
  return pageProtocol() === 'https:' && protocol === 'http:' ? 'mixed-content' : 'cors';
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length');
  if (raw === null || !/^\d{1,15}$/.test(raw.trim())) return undefined;
  const n = Number(raw);
  return n > 0 ? n : undefined;
}

/**
 * GETs `rawUrl` and streams the body into `parser`. Resolves when the body was read to the end (or
 * `onChunk` stopped it); rejects with a `NetError` (`aborted` when `signal` fired).
 */
export async function downloadM3u(
  rawUrl: string,
  parser: M3uParser,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const { signal, fetchImpl, rewriter } = options;
  const inactivityMs = options.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS;
  const url = rewriter ? rewriter.rewrite(rawUrl, 'playlist') : rawUrl;
  if (signal.aborted) throw new NetError({ kind: 'aborted', url });

  const controller = new AbortController();
  let timedOut = false;
  let responded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('No data received in time', 'TimeoutError'));
    }, inactivityMs);
  };
  const onCallerAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onCallerAbort, { once: true });
  // A fetch implementation or a body reader may ignore the signal: race them with it.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  aborted.catch(() => undefined);
  arm();

  try {
    const init: RequestInit = {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      cache: 'no-store',
    };
    const response = await Promise.race([
      fetchImpl ? fetchImpl(url, init) : fetch(url, init),
      aborted,
    ]);
    responded = true;
    arm();
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      throw new NetError({
        kind: response.status === 401 || response.status === 403 ? 'auth' : 'http',
        status: response.status,
        url,
      });
    }
    const total = contentLength(response);
    const body = response.body ?? new Blob([]).stream();
    let bytes = 0;
    const completed = await Promise.race([
      feedM3uStream(body, parser, {
        onBytes: (n) => {
          bytes = n;
          arm();
          options.onBytes?.(n, total);
        },
        onChunk: () => (controller.signal.aborted ? false : options.onChunk?.()),
        // Cancels the reader on abort/timeout even if the stream ignores the fetch signal.
        signal: controller.signal,
      }),
      aborted,
    ]);
    if (controller.signal.aborted) throw controller.signal.reason;
    return { bytes, completed };
  } catch (error) {
    if (error instanceof NetError) throw error;
    if (timedOut) throw new NetError({ kind: 'timeout', url });
    if (signal.aborted) throw new NetError({ kind: 'aborted', url });
    if (isOffline()) throw new NetError({ kind: 'offline', url });
    if (!responded && error instanceof TypeError) {
      throw new NetError({ kind: 'blocked', hint: blockedHint(url), url });
    }
    // The connection broke mid-body, or the fetch implementation failed oddly.
    throw new NetError({ kind: 'blocked', url });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', onCallerAbort);
  }
}
