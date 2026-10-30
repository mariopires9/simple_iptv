// Upstream requests (PRX-01): node:http/node:https with SSRF-safe DNS and manual redirects.
//
// Every hop (the first request and each redirect) is resolved here, ALL answers are checked
// against the address policy, and the socket is handed the vetted addresses through a pinned
// `lookup`, so a second DNS answer cannot redirect the connection (no DNS rebinding). IP-literal
// hosts never reach `lookup` in Node, so they are checked explicitly. TLS is verified normally.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { AddressPolicy } from './addresses.ts';
import { parseUpstreamUrl } from './url.ts';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** DNS resolution: every A/AAAA answer for `hostname`. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, order: 'verbatim' });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

export type UpstreamFailure =
  | { status: 403; code: 'address-blocked' }
  | {
      status: 502;
      code: 'upstream-unreachable' | 'upstream-tls' | 'too-many-redirects' | 'bad-redirect';
    }
  | { status: 504; code: 'upstream-timeout' }
  | { status: 499; code: 'aborted' };

export type UpstreamResult =
  | { ok: true; response: IncomingMessage; finalUrl: URL }
  | { ok: false; failure: UpstreamFailure; error?: unknown };

export interface UpstreamOptions {
  method: 'GET' | 'HEAD';
  headers: OutgoingHttpHeaders;
  signal: AbortSignal;
  maxRedirects: number;
  headersTimeoutMs: number;
  idleTimeoutMs: number;
  resolve: Resolver;
  addressPolicy: AddressPolicy;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** A `lookup` that only ever returns the already vetted addresses. */
function pinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const first = addresses[0];
    if (first === undefined) {
      callback(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), '', 4);
      return;
    }
    if (typeof options === 'object' && options !== null && options.all === true) {
      (callback as unknown as (err: null, list: ResolvedAddress[]) => void)(null, [...addresses]);
    } else {
      callback(null, first.address, first.family);
    }
  };
}

type Vetted =
  | { ok: true; addresses: ResolvedAddress[] }
  | { ok: false; failure: UpstreamFailure; error?: unknown };

async function vetHost(url: URL, options: UpstreamOptions): Promise<Vetted> {
  const literal = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const family = isIP(literal);
  if (family !== 0) {
    return options.addressPolicy(literal)
      ? { ok: true, addresses: [{ address: literal, family: family === 6 ? 6 : 4 }] }
      : { ok: false, failure: { status: 403, code: 'address-blocked' } };
  }
  let answers: ResolvedAddress[];
  try {
    answers = await options.resolve(url.hostname);
  } catch (error) {
    return { ok: false, failure: { status: 502, code: 'upstream-unreachable' }, error };
  }
  if (answers.length === 0)
    return { ok: false, failure: { status: 502, code: 'upstream-unreachable' } };
  // Refuse if ANY answer is blocked: a mixed answer set is a classic rebinding setup.
  if (answers.some((a) => isIP(a.address) === 0 || !options.addressPolicy(a.address))) {
    return { ok: false, failure: { status: 403, code: 'address-blocked' } };
  }
  return { ok: true, addresses: answers };
}

const TLS_CODE =
  /^(?:ERR_TLS_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|ERR_SSL_|HOSTNAME_MISMATCH)/;

type Hop =
  | { kind: 'response'; response: IncomingMessage }
  | { kind: 'failure'; failure: UpstreamFailure; error?: unknown };

function sendHop(
  url: URL,
  method: 'GET' | 'HEAD',
  addresses: ResolvedAddress[],
  options: UpstreamOptions,
): Promise<Hop> {
  return new Promise((resolve) => {
    const literal = url.hostname.replace(/^\[(.*)\]$/, '$1');
    const isHttps = url.protocol === 'https:';
    const send = isHttps ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (hop: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(headersTimer);
      options.signal.removeEventListener('abort', onAbort);
      if (hop.kind === 'failure') req.destroy();
      resolve(hop);
    };
    const req = send({
      protocol: url.protocol,
      hostname: literal,
      port: url.port === '' ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      headers: options.headers,
      agent: false,
      lookup: pinnedLookup(addresses),
      ...(isHttps && isIP(literal) === 0 ? { servername: literal } : {}),
    });
    const onAbort = () => finish({ kind: 'failure', failure: { status: 499, code: 'aborted' } });
    const headersTimer = setTimeout(
      () => finish({ kind: 'failure', failure: { status: 504, code: 'upstream-timeout' } }),
      options.headersTimeoutMs,
    );
    options.signal.addEventListener('abort', onAbort, { once: true });
    // Idle timeout until the response arrives (socket inactivity); then for the body, see
    // `watchBodyIdle`.
    req.setTimeout(options.idleTimeoutMs, () => {
      req.destroy(Object.assign(new Error('upstream idle'), { code: 'ETIMEDOUT' }));
    });
    req.on('response', (response) => {
      // A socket timeout would also fire while the CLIENT does not read (backpressure: the body
      // is paused, so the socket goes quiet) — e.g. a live stream the browser stopped fetching.
      req.setTimeout(0);
      watchBodyIdle(response, options.idleTimeoutMs);
      finish({ kind: 'response', response });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      const code =
        typeof error.code === 'string' && TLS_CODE.test(error.code)
          ? 'upstream-tls'
          : 'upstream-unreachable';
      finish({ kind: 'failure', failure: { status: 502, code }, error });
    });
    if (options.signal.aborted) onAbort();
    else req.end();
  });
}

/**
 * Body idle timeout (PLY-07): destroys `response` only when the upstream sends nothing for
 * `idleMs` while the body is being read. While it is paused (the client is not reading:
 * backpressure, a player that stopped fetching), the quiet time does not count; a client that
 * leaves closes the upstream anyway (the relay aborts it).
 */
export function watchBodyIdle(response: IncomingMessage, idleMs: number): void {
  // Progress is read from the socket's byte counter: a 'data' listener on the body would switch
  // it to flowing mode before the relay is ready to read it.
  const bytesRead = () => response.socket?.bytesRead ?? 0;
  let seen = bytesRead();
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const check = () => {
    timer = undefined;
    if (response.destroyed || response.readableEnded) return;
    const now = Date.now();
    const read = bytesRead();
    // New bytes, a paused body or a full buffer (the consumer is not reading): not idle.
    if (
      read !== seen ||
      response.isPaused() ||
      response.readableLength >= response.readableHighWaterMark
    ) {
      seen = read;
      last = now;
    } else if (now - last >= idleMs) {
      response.destroy(Object.assign(new Error('upstream idle'), { code: 'ETIMEDOUT' }));
      return;
    }
    timer = setTimeout(check, Math.max(50, Math.min(idleMs, last + idleMs - now)));
  };
  response.once('end', stop);
  response.once('close', stop);
  timer = setTimeout(check, idleMs);
}

/**
 * Requests `start` and follows up to `maxRedirects` redirects inside the proxy. Redirects are never
 * forwarded to the client. Each hop must be http(s), without userinfo, and pass the address policy
 * (an https → http downgrade is allowed: it is the reason this proxy exists).
 */
export async function openUpstream(start: URL, options: UpstreamOptions): Promise<UpstreamResult> {
  let url = start;
  let method = options.method;
  for (let hop = 0; ; hop++) {
    if (options.signal.aborted) return { ok: false, failure: { status: 499, code: 'aborted' } };
    const vetted = await vetHost(url, options);
    if (!vetted.ok) return { ok: false, failure: vetted.failure, error: vetted.error };
    if (options.signal.aborted) return { ok: false, failure: { status: 499, code: 'aborted' } };
    const result = await sendHop(url, method, vetted.addresses, options);
    if (result.kind === 'failure')
      return { ok: false, failure: result.failure, error: result.error };
    const { response } = result;
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (!REDIRECTS.has(status) || typeof location !== 'string') {
      return { ok: true, response, finalUrl: url };
    }
    response.destroy();
    if (hop >= options.maxRedirects) {
      return { ok: false, failure: { status: 502, code: 'too-many-redirects' } };
    }
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return { ok: false, failure: { status: 502, code: 'bad-redirect' } };
    }
    const checked = parseUpstreamUrl(next.href);
    if (!checked.ok) return { ok: false, failure: { status: 502, code: 'bad-redirect' } };
    url = checked.url;
    if (status === 303 && method !== 'HEAD') method = 'GET';
  }
}
