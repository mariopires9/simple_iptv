// HTTP helpers for external servers (SRC-02, docs/ARCHITECTURE.md §4 and §8, RESEARCH.md §6).
// Every failure becomes a `NetError`; the raw URL is never logged or stored (only `shortenUrl`).
import { MASK, log } from '@/core/log';
import { NetError, shortenUrl, type NetErrorHint } from './errors';

/** What a request is for; lets a `UrlRewriter` (e.g. a self-hosted proxy, ADR-010) route it. */
export type RequestPurpose = 'api' | 'playlist' | 'stream' | 'image' | 'epg';

/** Extension point for HTTP-only/no-CORS servers (ADR-010). The MVP uses the identity. */
export interface UrlRewriter {
  rewrite(url: string, purpose: RequestPurpose): string;
}

export const identityRewriter: UrlRewriter = { rewrite: (url) => url };

/** Default timeout for a request, including reading the body. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchOptions {
  /** Caller cancellation; aborting rejects with `NetError(kind='aborted')`. */
  signal?: AbortSignal;
  /** Overall timeout in ms (request + body). Default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Default `api`. API calls are sent with `cache: 'no-store'`. */
  purpose?: RequestPurpose;
  /** Default {@link identityRewriter}. */
  rewriter?: UrlRewriter;
  /** Default: the global `fetch`, looked up at call time. */
  fetchImpl?: FetchImpl;
}

const HTML_START = /^\s*<(?:!doctype|html|head|body|\?xml)/i;

function pageProtocol(): string | undefined {
  const location = (globalThis as { location?: { protocol?: unknown } }).location;
  return typeof location?.protocol === 'string' ? location.protocol : undefined;
}

function isOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  return nav?.onLine === false;
}

/**
 * The browser reports CORS, mixed-content and DNS failures all as the same `TypeError`.
 * An `http:` request from an `https:` page can only be mixed content; anything else is reported
 * as `cors` (the most likely cause for a reachable panel).
 */
function blockedHint(url: string): NetErrorHint {
  let protocol: string | undefined;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = undefined;
  }
  return pageProtocol() === 'https:' && protocol === 'http:' ? 'mixed-content' : 'cors';
}

interface RequestState {
  url: string;
  timedOut: () => boolean;
  callerAborted: () => boolean;
}

/**
 * NetError redacts credentials in the cause but keeps hosts; runtimes such as undici may put the
 * full URL in the message. Keep only name + message with the URL and host masked (no stack).
 */
function safeCause(error: unknown, url: string): unknown {
  if (!(error instanceof Error)) return error;
  let message = error.message.split(url).join(shortenUrl(url) ?? MASK);
  try {
    const { host, hostname } = new URL(url);
    for (const h of [host, hostname]) if (h !== '') message = message.split(h).join(MASK);
  } catch {
    // Not a URL: nothing else to mask.
  }
  const copy = new Error(message);
  copy.name = error.name;
  delete copy.stack;
  return copy;
}

/** Maps anything thrown by fetch or by reading the body to a `NetError`. */
function classify(thrown: unknown, state: RequestState): NetError {
  if (thrown instanceof NetError) return thrown;
  const { url } = state;
  const error = safeCause(thrown, url);
  if (state.timedOut()) return new NetError({ kind: 'timeout', url, cause: error });
  if (state.callerAborted()) return new NetError({ kind: 'aborted', url, cause: error });
  if (thrown instanceof DOMException && thrown.name === 'AbortError') {
    return new NetError({ kind: 'aborted', url, cause: error });
  }
  if (isOffline()) return new NetError({ kind: 'offline', url, cause: error });
  if (thrown instanceof TypeError) {
    return new NetError({ kind: 'blocked', hint: blockedHint(url), url, cause: error });
  }
  // Anything else (a broken fetchImpl, a body stream error…): the request did not complete.
  return new NetError({ kind: 'blocked', url, cause: error });
}

/**
 * Runs a GET request and passes the response to `read` while the timeout is still armed, so a
 * body that never finishes also times out. The timeout uses `setTimeout` (works with fake timers).
 */
async function request<T>(
  rawUrl: string,
  options: FetchOptions,
  read: (response: Response, url: string) => Promise<T>,
): Promise<T> {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    purpose = 'api',
    rewriter = identityRewriter,
    fetchImpl,
  } = options;
  const url = rewriter.rewrite(rawUrl, purpose);

  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(signal?.reason);
  const state: RequestState = {
    url,
    timedOut: () => timedOut,
    callerAborted: () => signal?.aborted === true,
  };

  if (signal?.aborted) throw new NetError({ kind: 'aborted', url });
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  const init: RequestInit = {
    method: 'GET',
    signal: controller.signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'follow',
  };
  if (purpose === 'api') init.cache = 'no-store';

  try {
    // A fetchImpl or a body read may ignore the signal: race both with it so abort/timeout always win.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      });
    });
    aborted.catch(() => undefined);
    const response = await Promise.race([
      fetchImpl ? fetchImpl(url, init) : fetch(url, init),
      aborted,
    ]);
    if (response.status === 401 || response.status === 403) {
      throw new NetError({ kind: 'auth', status: response.status, url });
    }
    if (!response.ok) throw new NetError({ kind: 'http', status: response.status, url });
    return await Promise.race([read(response, url), aborted]);
  } catch (error) {
    const netError = classify(error, state);
    log.warn('Network request failed', {
      kind: netError.kind,
      status: netError.status,
      hint: netError.hint,
      purpose,
      target: shortenUrl(url),
    });
    throw netError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** GET as text. Non-2xx → `http` (401/403 → `auth`). */
export function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return request(url, options, (response) => response.text());
}

/**
 * GET as JSON (`unknown`: validate with a schema). An HTML page or invalid JSON → `parse`.
 */
export function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
  return request(url, options, async (response, target) => {
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (/\bhtml\b/i.test(contentType) || HTML_START.test(text)) {
      throw new NetError({ kind: 'parse', url: target, cause: 'HTML instead of JSON' });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // The parser message may quote the body: never keep it as the cause.
      throw new NetError({ kind: 'parse', url: target, cause: 'Invalid JSON' });
    }
  });
}
