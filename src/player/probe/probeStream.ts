// Root-cause probe of a stream that failed to play (PLY-06). Run only after a failure (or from
// the diagnostics screen), once per address: it explains what the browser allows, it never works
// around it.
//
// 1. An `http:` address on an `https:` page is reported without any request (mixed content).
// 2. A normal (CORS) `fetch` that follows redirects reads the first bytes only, then cancels:
//    the final address (`response.url`), the HTTP status and the start of the content (HLS
//    playlist with `http://` URIs or HEVC `CODECS`; MPEG-TS with an HEVC program map).
// 3. When that fetch fails with a TypeError (the browser does not say why), one `no-cors`
//    request that follows redirects tells the usual causes apart without reading anything: if it
//    succeeds, the address is reachable but sends no CORS headers; if it fails too, on an https
//    page the usual cause is a redirect to an http:// address (blocked), otherwise the address is
//    unreachable. (`no-cors` with `redirect: 'manual'` is always a network error per the Fetch
//    Standard, so whether the server redirects cannot be observed.) The opaque response — no
//    body, header or status is readable — is aborted at once. The same applies to the first
//    variant of a master playlist.
//
// The URL is never logged nor returned: results carry the masked form (`shortenUrl`) only.
import { log } from '@/core/log';
import { parseExternalUrl, shortenUrl } from '@/core/net';
import { errorName, isMixedContent } from '../errors';
import { sniffContent, type SniffedContent } from './sniff';

/** Whole-probe timeout (all requests of one address). */
export const PROBE_TIMEOUT_MS = 8_000;
/** At most this many bytes are read from a readable response. */
export const PROBE_MAX_BYTES = 64 * 1024;

export type ProbeCause =
  /** The address answered and the start looks like a playable stream. */
  | 'ok'
  /** The stream address itself is `http:` on an `https:` page (not requested). */
  | 'insecure-url'
  /**
   * A readable response ended on an `http:` address. Browsers fail such a CORS fetch from an
   * `https:` page before it is readable (then `redirect-blocked`); kept for pages served on http.
   */
  | 'insecure-redirect'
  /** The playlist lists `http:` segments/variants (blocked on an `https:` page). */
  | 'insecure-segments'
  /**
   * On an `https:` page, even a `no-cors` request failed: usually a redirect to an `http:`
   * address (blocked), otherwise an unreachable server — the browser does not say which.
   */
  | 'redirect-blocked'
  /** Reachable, but the server sends no CORS headers: web engines (fetch) cannot read it. */
  | 'no-cors'
  /** Every request failed on a non-https page: unreachable or blocked. */
  | 'unreachable'
  /** HTTP 401/403. */
  | 'auth'
  /** Another HTTP error status. */
  | 'http-error'
  /** The server answered with something that is neither a playlist nor MPEG-TS (or nothing). */
  | 'not-media'
  | 'timeout'
  | 'invalid-url';

export interface StreamProbeResult {
  cause: ProbeCause;
  /** Masked address probed (`shortenUrl`). */
  target?: string;
  /** HTTP status, when the browser exposed one. */
  status?: number;
  /** The server redirected (known from a readable response or an opaque redirect). */
  redirected?: boolean;
  /** HEVC declared in the playlist (`CODECS`) or in the MPEG-TS program map. */
  hevc?: boolean;
  /** What the start of a readable response was. */
  content?: SniffedContent['type'];
}

export type ProbeFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ProbeOptions {
  /** Default: global `fetch`. */
  fetch?: ProbeFetch;
  /** Default: `location.protocol`. */
  pageProtocol?: string | undefined;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

function defaultPageProtocol(): string | undefined {
  const location = (globalThis as { location?: { protocol?: unknown } }).location;
  return typeof location?.protocol === 'string' ? location.protocol : undefined;
}

/** Reads at most `max` bytes of `response`, then cancels the rest. */
async function readHead(response: Response, max: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer()).subarray(0, max);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    // A live stream never ends: stop downloading it.
    reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) break;
  }
  return out;
}

class ProbeTimeout extends Error {
  override readonly name = 'ProbeTimeout';
}

/** Probes one stream address. Never rejects (an aborted `signal` resolves as `timeout`). */
export async function probeStream(
  url: string,
  options: ProbeOptions = {},
): Promise<StreamProbeResult> {
  const doFetch: ProbeFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const pageProtocol = 'pageProtocol' in options ? options.pageProtocol : defaultPageProtocol();
  const maxBytes = options.maxBytes ?? PROBE_MAX_BYTES;
  const target = shortenUrl(url);
  const base: Pick<StreamProbeResult, 'target'> = target !== undefined ? { target } : {};

  if (!parseExternalUrl(url, 'stream').ok) return { ...base, cause: 'invalid-url' };
  if (isMixedContent(url, pageProtocol)) return { ...base, cause: 'insecure-url' };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ProbeTimeout()),
    options.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted === true) controller.abort();
  const common: RequestInit = {
    signal: controller.signal,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  };

  try {
    let response: Response;
    try {
      response = await doFetch(url, { ...common, redirect: 'follow' });
    } catch (e) {
      if (controller.signal.aborted) return { ...base, cause: 'timeout' };
      log.info('probe: readable request failed', { error: errorName(e), target });
      return { ...base, ...(await opaqueProbe(url, { pageProtocol, doFetch, common })) };
    }
    return {
      ...base,
      ...(await readable(response, url, { pageProtocol, maxBytes, doFetch, common })),
    };
  } catch (e) {
    if (controller.signal.aborted) return { ...base, cause: 'timeout' };
    log.warn('probe: unexpected failure', { error: errorName(e), target });
    return { ...base, cause: 'unreachable' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    // Stops any download still running (e.g. an opaque live stream).
    controller.abort();
  }
}

interface ReadContext {
  pageProtocol: string | undefined;
  maxBytes: number;
  doFetch: ProbeFetch;
  common: RequestInit;
}

const cancel = (response: Response) => {
  response.body?.cancel().catch(() => undefined);
};

/** A textual content type that is not a playlist (error pages, JSON answers). */
const TEXTUAL = /^(text\/(html|plain|xml)|application\/(json|xml|xhtml))/i;

async function readable(
  response: Response,
  url: string,
  ctx: ReadContext,
  followVariant = true,
): Promise<Omit<StreamProbeResult, 'target'>> {
  const finalUrl = response.url !== '' ? response.url : url;
  const redirected = response.redirected;
  const extra = {
    ...(redirected ? { redirected: true } : {}),
    ...(response.status > 0 ? { status: response.status } : {}),
  };
  if (redirected && isMixedContent(finalUrl, ctx.pageProtocol)) {
    cancel(response);
    return { cause: 'insecure-redirect', ...extra };
  }
  if (response.status === 401 || response.status === 403) {
    cancel(response);
    return { cause: 'auth', ...extra };
  }
  if (!response.ok) {
    cancel(response);
    return { cause: 'http-error', ...extra };
  }
  const content = sniffContent(await readHead(response, ctx.maxBytes), finalUrl);
  const out = { ...extra, content: content.type };
  const hevc = (content.type === 'playlist' || content.type === 'ts') && content.hevc;
  const withHevc = hevc ? { hevc: true } : {};
  if (content.type === 'playlist' && content.httpUris > 0 && ctx.pageProtocol === 'https:') {
    return { cause: 'insecure-segments', ...out, ...withHevc };
  }
  const textual = TEXTUAL.test(response.headers.get('content-type') ?? '');
  if (
    content.type === 'empty' ||
    content.type === 'text' ||
    (content.type === 'other' && textual)
  ) {
    return { cause: 'not-media', ...out };
  }
  // Master playlist: the segments are listed in its variants. One more request (the first
  // variant) shows whether those point at http:// or redirect there.
  if (content.type === 'playlist' && content.variant !== undefined && followVariant) {
    const variant = await variantFinding(content.variant, ctx);
    const merged = variant.hevc === true || hevc ? { hevc: true } : {};
    // Whatever stops the variant stops the stream; a readable variant only adds HEVC.
    return variant.cause === 'ok'
      ? { cause: 'ok', ...out, ...merged }
      : { ...out, ...merged, cause: variant.cause };
  }
  return { cause: 'ok', ...out, ...withHevc };
}

/** The first variant of a master playlist, read like the master. */
async function variantFinding(
  variantUrl: string,
  ctx: ReadContext,
): Promise<Omit<StreamProbeResult, 'target'>> {
  if (isMixedContent(variantUrl, ctx.pageProtocol)) return { cause: 'insecure-segments' };
  try {
    const response = await ctx.doFetch(variantUrl, { ...ctx.common, redirect: 'follow' });
    return await readable(response, variantUrl, ctx, false);
  } catch (e) {
    if (ctx.common.signal?.aborted === true) throw e;
    // A variant the browser cannot read: no CORS on its host, or a redirect to http://.
    return opaqueProbe(variantUrl, ctx);
  }
}

/** The `no-cors` request; its opaque response is never read. */
async function opaqueProbe(
  url: string,
  ctx: Pick<ReadContext, 'pageProtocol' | 'doFetch' | 'common'>,
): Promise<Omit<StreamProbeResult, 'target'>> {
  try {
    await ctx.doFetch(url, { ...ctx.common, mode: 'no-cors', redirect: 'follow' });
  } catch (e) {
    if (ctx.common.signal?.aborted === true) throw e;
    // Blocked even without CORS: on an https page, usually a redirect to http:// (mixed content).
    return { cause: ctx.pageProtocol === 'https:' ? 'redirect-blocked' : 'unreachable' };
  }
  return { cause: 'no-cors' };
}
