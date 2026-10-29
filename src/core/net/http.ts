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

const MAX_CAUSE_DEPTH = 3;

/**
 * NetError redacts credentials in the cause but keeps hosts; runtimes such as undici may put the
 * full URL in the message. Keep name + message (URL and host masked, no stack) and the inner cause
 * chain (e.g. ECONNREFUSED / ENOTFOUND / TLS errors), depth-limited and masked the same way.
 */
function safeCause(error: unknown, url: string, depth = 1): unknown {
  if (error === undefined || depth > MAX_CAUSE_DEPTH) return undefined;
  const mask = (text: string): string => {
    let out = text.split(url).join(shortenUrl(url) ?? MASK);
    try {
      const { host, hostname } = new URL(url);
      for (const h of [host, hostname]) if (h !== '') out = out.split(h).join(MASK);
    } catch {
      // Not a URL: nothing else to mask.
    }
    return out;
  };
  if (!(error instanceof Error)) {
    if (error !== null && typeof error === 'object') {
      try {
        return mask(JSON.stringify(error));
      } catch {
        return '[unserializable cause]';
      }
    }
    return mask(String(error));
  }
  const inner = safeCause((error as { cause?: unknown }).cause, url, depth + 1);
  const copy = new Error(mask(error.message), inner !== undefined ? { cause: inner } : undefined);
  copy.name = error.name;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) {
    (copy as { code?: string }).code = code;
    if (!copy.message.includes(code)) copy.message = `${copy.message} (${code})`;
  }
  delete copy.stack;
  return copy;
}

/** Error bodies up to this size are drained (keeps the connection reusable); larger ones are cancelled. */
const MAX_DRAIN_BYTES = 64 * 1024;

/**
 * Releases an unused error body (401/403/non-2xx) so the connection is not held open: a small
 * body is drained, anything beyond {@link MAX_DRAIN_BYTES} is cancelled (`body.cancel()`).
 * Errors are ignored. An abort/timeout cancels the reader.
 */
async function discardBody(response: Response, signal: AbortSignal): Promise<void> {
  const body = response.body;
  if (body === null || response.bodyUsed) return;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const onAbort = () => {
    reader?.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    reader = body.getReader();
    if (signal.aborted) onAbort();
    let received = 0;
    while (received <= MAX_DRAIN_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      received += value.byteLength;
    }
    await reader.cancel();
  } catch {
    // Best effort.
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Reads the body as UTF-8 text (like `Response.text()`) with its own reader, so an abort or
 * timeout can cancel the stream even when the fetch implementation ignores the signal.
 */
async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => undefined);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Maps anything thrown by fetch or by reading the body to a `NetError`. */
function classify(thrown: unknown, state: RequestState): NetError {
  if (thrown instanceof NetError) return thrown;
  const { url } = state;
  const error = safeCause(thrown, url);
  if (state.timedOut()) return new NetError({ kind: 'timeout', url, cause: error });
  if (state.callerAborted()) return new NetError({ kind: 'aborted', url, cause: error });
  // An AbortError nobody here asked for (e.g. the connection was torn down) is a network failure.
  if (isOffline()) return new NetError({ kind: 'offline', url, cause: error });
  if (thrown instanceof TypeError) {
    return new NetError({ kind: 'blocked', hint: blockedHint(url), url, cause: error });
  }
  // Anything else (a broken fetchImpl, a body stream error…): the request did not complete.
  return new NetError({ kind: 'blocked', url, cause: error });
}

/** Hands to the caller an error that must not be classified as a network failure. */
class ConsumerError {
  constructor(readonly error: unknown) {}
}

interface ReadContext {
  /** Aborted on timeout / caller abort. */
  signal: AbortSignal;
  /** Re-arms the timer (inactivity mode only; a no-op otherwise). */
  keepAlive: () => void;
  /** Request URL (after the rewriter). */
  url: string;
}

interface RequestMode {
  /** `inactivity`: the timeout restarts on every `keepAlive()` (streaming downloads). */
  timeout: 'overall' | 'inactivity';
}

/**
 * Runs a GET request and passes the response to `read` while the timeout is still armed, so a
 * body that never finishes also times out. The timeout uses `setTimeout` (works with fake timers).
 * Errors thrown by `read` wrapped in {@link ConsumerError} reach the caller unchanged; any other
 * error is classified as a `NetError`.
 */
async function request<T>(
  rawUrl: string,
  options: FetchOptions,
  read: (response: Response, ctx: ReadContext) => Promise<T>,
  mode: RequestMode = { timeout: 'overall' },
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  };
  arm();

  const init: RequestInit = {
    method: 'GET',
    signal: controller.signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'follow',
  };
  if (purpose === 'api' || mode.timeout === 'inactivity') init.cache = 'no-store';

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
      await Promise.race([discardBody(response, controller.signal), aborted]);
      throw new NetError({ kind: 'auth', status: response.status, url });
    }
    if (!response.ok) {
      await Promise.race([discardBody(response, controller.signal), aborted]);
      throw new NetError({ kind: 'http', status: response.status, url });
    }
    const ctx: ReadContext = {
      signal: controller.signal,
      keepAlive: mode.timeout === 'inactivity' ? arm : () => undefined,
      url,
    };
    return await Promise.race([read(response, ctx), aborted]);
  } catch (error) {
    if (error instanceof ConsumerError) {
      // Not a network failure (e.g. a bug in the consumer): cancel the body, pass it on as is.
      controller.abort(new DOMException('Consumer failed', 'AbortError'));
      throw error.error;
    }
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
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** GET as text. Non-2xx → `http` (401/403 → `auth`). */
export function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return request(url, options, (response, ctx) => readBody(response, ctx.signal));
}

/**
 * GET as JSON (`unknown`: validate with a schema). The content type is not trusted: many PHP
 * panels send JSON as `text/html`. Only a body that does not parse → `parse`; the content type
 * and an HTML-looking body only select the diagnostic cause.
 */
export function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
  return request(url, options, async (response, ctx) => {
    const text = await readBody(response, ctx.signal);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      const contentType = response.headers.get('content-type') ?? '';
      const html = HTML_START.test(text) || /\bhtml\b/i.test(contentType);
      // The parser message may quote the body: never keep it as the cause.
      throw new NetError({
        kind: 'parse',
        url: ctx.url,
        cause: html ? 'HTML instead of JSON' : 'Invalid JSON',
      });
    }
  });
}

/** Pull-based access to a streamed response body (see {@link fetchStream}). */
export interface StreamBody {
  /** Next chunk, or `undefined` at the end. Re-arms the inactivity timeout. */
  read(): Promise<Uint8Array | undefined>;
  /** Bytes read so far. */
  readonly bytes: number;
  /**
   * Announced size (`Content-Length`) when it describes the bytes `read` returns, i.e. only
   * without a `Content-Encoding` (or `identity`): browsers decompress transparently, so a
   * compressed length would be smaller than what is read.
   */
  readonly total: number | undefined;
  readonly response: Response;
}

export interface FetchStreamOptions extends Omit<FetchOptions, 'timeoutMs'> {
  /** No byte (or no response) for this long → `timeout`. Default {@link DEFAULT_TIMEOUT_MS}. */
  inactivityTimeoutMs?: number;
}

function streamTotal(response: Response): number | undefined {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== '' && encoding !== 'identity') return undefined;
  const raw = response.headers.get('content-length')?.trim();
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > 0 ? n : undefined;
}

/**
 * GET whose body is consumed as a stream by `consume`, with an *inactivity* timeout (re-armed on
 * every chunk): a large download on a slow link may take minutes while making progress.
 * Network failures (before or during the body) are `NetError`s with the same classification as
 * {@link fetchText}; a failure while reading the body after the server answered is `blocked`
 * without a CORS/mixed-content hint (the browser did let the response through). Anything `consume`
 * throws itself (e.g. a parser bug) is passed through unchanged, and the body is cancelled.
 */
export function fetchStream<T>(
  url: string,
  consume: (body: StreamBody) => Promise<T>,
  options: FetchStreamOptions = {},
): Promise<T> {
  const { inactivityTimeoutMs, ...rest } = options;
  const requestOptions: FetchOptions = { ...rest, purpose: rest.purpose ?? 'playlist' };
  if (inactivityTimeoutMs !== undefined) requestOptions.timeoutMs = inactivityTimeoutMs;
  return request(
    url,
    requestOptions,
    async (response, ctx) => {
      const source = response.body ?? new Blob([]).stream();
      const reader = source.getReader();
      const onAbort = () => {
        reader.cancel(ctx.signal.reason).catch(() => undefined);
      };
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
      let bytes = 0;
      const total = streamTotal(response);
      const body: StreamBody = {
        async read() {
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await reader.read();
          } catch (error) {
            if (ctx.signal.aborted) throw ctx.signal.reason;
            throw new NetError({
              kind: isOffline() ? 'offline' : 'blocked',
              url: ctx.url,
              cause: safeCause(error, ctx.url),
            });
          }
          if (ctx.signal.aborted) throw ctx.signal.reason;
          if (result.done) return undefined;
          bytes += result.value.byteLength;
          ctx.keepAlive();
          return result.value;
        },
        get bytes() {
          return bytes;
        },
        total,
        response,
      };
      try {
        return await consume(body);
      } catch (error) {
        // Errors produced by `read()` (NetError / abort reasons) are classified; anything else
        // came from the consumer itself.
        if (error instanceof NetError || ctx.signal.aborted) throw error;
        throw new ConsumerError(error);
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
        reader.cancel().catch(() => undefined);
      }
    },
    { timeout: 'inactivity' },
  );
}
