// The proxy request handler (PRX-01, ADR-010). See proxy/README.md for the URL contract.
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { defaultAddressPolicy, type AddressPolicy } from './addresses.ts';
import { createGrantSigner, tokenMatches } from './auth.ts';
import { isHostAllowed, type ProxyConfig } from './config.ts';
import { ERROR_HEADER, evaluateOrigin, setBaseHeaders, writePreflight } from './cors.ts';
import { SNIFF_WINDOW, rewritePlaylist, sniffPlaylist } from './hls.ts';
import { createBadTokenLimiter, createRateLimiter } from './limits.ts';
import { createLogger, errorCode, type Logger } from './log.ts';
import { openUpstream, systemResolver, type Resolver } from './upstream.ts';
import { API_VERSION, buildProxyUrl, parseProxyPath, parseUpstreamUrl } from './url.ts';

export interface ProxyDeps {
  /** DNS resolver (tests inject a fake one; the network is never touched in tests). */
  resolve?: Resolver;
  /** Address policy. Only tests replace it (to reach a fake upstream on 127.0.0.1). */
  addressPolicy?: AddressPolicy;
  /** Clock in milliseconds, for rate limits and grants. */
  now?: () => number;
  logger?: Logger;
}

export interface ProxyServer {
  server: Server;
  /** Upstream requests currently open (also reported by the health endpoint). */
  activeUpstreams(): number;
  /** Stops accepting connections, aborts upstreams and closes client connections. */
  close(): Promise<void>;
}

/** Request headers forwarded upstream; everything else (Cookie, Authorization, Origin…) is dropped. */
const FORWARDED_REQUEST_HEADERS = ['range', 'if-range', 'accept', 'user-agent'] as const;
/** Response headers passed back to the client (Set-Cookie and the rest are dropped). */
const PASSED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
  'content-encoding',
] as const;
const DECODABLE = new Set(['gzip', 'x-gzip', 'deflate', 'br']);
const HOST_HEADER =
  /^(?:[A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}(?::\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$/;

class Refusal {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    this.status = status;
    this.code = code;
  }
}

/** Only the encodings the proxy can decode for playlist rewriting are offered upstream. */
function acceptEncoding(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const offered = header
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim().toLowerCase() ?? '')
    .filter((coding) => DECODABLE.has(coding));
  return offered.length > 0 ? [...new Set(offered)].join(', ') : undefined;
}

function decoderFor(encoding: string): Transform | null {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      return null;
  }
}

/**
 * The public base URL of this proxy as seen by the client, for URLs written into playlists:
 * `publicBaseUrl` when configured, else `X-Forwarded-Proto` (set by Tailscale Serve) + `Host`.
 */
export function publicBaseFor(req: IncomingMessage, config: ProxyConfig): string {
  if (config.publicBaseUrl !== undefined) return config.publicBaseUrl;
  const forwarded = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim().toLowerCase() : undefined;
  const scheme = proto === 'https' || proto === 'http' ? proto : 'http';
  const host = req.headers.host;
  if (typeof host === 'string' && HOST_HEADER.test(host))
    return `${scheme}://${host.toLowerCase()}`;
  const listenHost = config.listen.host.includes(':')
    ? `[${config.listen.host}]`
    : config.listen.host;
  return `http://${listenHost}:${config.listen.port}`;
}

type Sniffed =
  | { kind: 'pass'; prefix: Buffer[] }
  | { kind: 'hls'; text: string }
  | { kind: 'too-large' }
  | { kind: 'failed' };

/**
 * Reads just enough of the body to know whether it is an HLS playlist. Non-HLS bodies are handed
 * back with the raw bytes read so far (`prefix`) and the source paused, to be streamed unchanged;
 * HLS playlists are read to the end (decoded if needed) within `maxBytes`.
 */
function sniffBody(source: Readable, encoding: string, maxBytes: number): Promise<Sniffed> {
  return new Promise((resolve) => {
    const raw: Buffer[] = [];
    let rawBytes = 0;
    const decoded: Buffer[] = [];
    let decodedBytes = 0;
    let mode: 'sniff' | 'collect' = 'sniff';
    let done = false;
    let sourceEnded = false;
    const decoder = encoding === 'identity' ? null : decoderFor(encoding);

    const cleanup = () => {
      source.off('data', onData);
      source.off('end', onEnd);
      source.off('error', onError);
      source.off('close', onClose);
      decoder?.removeAllListeners();
    };
    const settle = (result: Sniffed) => {
      if (done) return;
      done = true;
      cleanup();
      if (result.kind === 'pass') source.pause();
      if (decoder !== null) {
        decoder.on('error', () => {});
        decoder.destroy();
      }
      resolve(result);
    };
    const decide = () => {
      if (mode !== 'sniff') return;
      const prefix = Buffer.concat(decoded).subarray(0, SNIFF_WINDOW).toString('latin1');
      const complete = sourceEnded || decodedBytes >= SNIFF_WINDOW;
      const verdict = sniffPlaylist(prefix, complete);
      if (verdict === 'hls') mode = 'collect';
      else if (verdict === 'not-hls') settle({ kind: 'pass', prefix: raw });
      // A body that is not text cannot hold a long undecided prefix: cap the raw buffer too.
      else if (rawBytes > maxBytes) settle({ kind: 'pass', prefix: raw });
    };
    const addDecoded = (chunk: Buffer) => {
      if (done) return;
      decoded.push(chunk);
      decodedBytes += chunk.length;
      decide();
      if (!done && mode === 'collect' && decodedBytes > maxBytes) {
        settle({ kind: 'too-large' });
        source.destroy();
      }
    };
    const finishCollect = () => {
      decide();
      if (done) return;
      if (mode === 'sniff') {
        settle({ kind: 'pass', prefix: raw });
        return;
      }
      settle({ kind: 'hls', text: Buffer.concat(decoded).toString('utf8') });
    };
    const onData = (chunk: Buffer) => {
      if (mode === 'sniff') raw.push(chunk);
      rawBytes += chunk.length;
      if (decoder === null) addDecoded(chunk);
      else decoder.write(chunk);
    };
    const onEnd = () => {
      sourceEnded = true;
      if (decoder === null) finishCollect();
      else decoder.end();
    };
    const onError = () => settle({ kind: 'failed' });
    const onClose = () => {
      if (!sourceEnded) settle({ kind: 'failed' });
    };

    if (decoder !== null) {
      decoder.on('data', addDecoded);
      decoder.on('end', () => {
        sourceEnded = true;
        finishCollect();
      });
      // Undecodable while sniffing: not something we can rewrite, pass it through as-is.
      decoder.on('error', () => {
        if (mode === 'sniff') settle({ kind: 'pass', prefix: raw });
        else settle({ kind: 'failed' });
      });
    }
    source.on('data', onData);
    source.on('end', onEnd);
    source.on('error', onError);
    source.on('close', onClose);
  });
}

export function createProxyServer(config: ProxyConfig, deps: ProxyDeps = {}): ProxyServer {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? createLogger();
  const resolve = deps.resolve ?? systemResolver;
  const addressPolicy = deps.addressPolicy ?? defaultAddressPolicy;
  const rateLimiter = createRateLimiter(config.limits.requestsPerMinute, now);
  const badTokens = createBadTokenLimiter(config.limits.badTokenPerMinute, now);
  const grants = createGrantSigner(config.token, config.grantTtlSeconds, now);
  const upstreamAborts = new Set<AbortController>();
  let active = 0;

  const refuse = (res: ServerResponse, refusal: Refusal, extra: OutgoingHttpHeaders = {}) => {
    res.writeHead(refusal.status, {
      ...extra,
      [ERROR_HEADER]: refusal.code,
      'Content-Length': '0',
    });
    res.end();
  };

  const forwardHeaders = (req: IncomingMessage, target: URL): OutgoingHttpHeaders => {
    const headers: OutgoingHttpHeaders = {};
    // Playlists are always fetched whole so they can be rewritten (Range is ignored for them).
    const playlist = /\.m3u8?$/i.test(target.pathname);
    for (const name of FORWARDED_REQUEST_HEADERS) {
      if (playlist && (name === 'range' || name === 'if-range')) continue;
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const encoding = acceptEncoding(req.headers['accept-encoding']);
    headers['accept-encoding'] = encoding ?? 'identity';
    return headers;
  };

  async function relay(
    req: IncomingMessage,
    res: ServerResponse,
    target: URL,
  ): Promise<{ status: number; code?: string; bytes?: number }> {
    if (active >= config.limits.maxConcurrentUpstreams)
      throw new Refusal(429, 'too-many-upstreams');
    const controller = new AbortController();
    upstreamAborts.add(controller);
    active++;
    // The provider usually allows ONE connection: close upstream as soon as the client leaves.
    const onClientClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.on('close', onClientClose);
    try {
      const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
      const result = await openUpstream(target, {
        method,
        headers: forwardHeaders(req, target),
        signal: controller.signal,
        maxRedirects: config.upstream.maxRedirects,
        headersTimeoutMs: config.upstream.headersTimeoutMs,
        idleTimeoutMs: config.upstream.idleTimeoutMs,
        resolve,
        addressPolicy,
      });
      if (!result.ok) {
        if (result.error !== undefined)
          logger.log({ event: 'upstream-error', code: errorCode(result.error) });
        if (result.failure.status === 499) return { status: 499, code: 'aborted' };
        throw new Refusal(result.failure.status, result.failure.code);
      }
      const { response, finalUrl } = result;
      controller.signal.addEventListener('abort', () => response.destroy(), { once: true });
      if (controller.signal.aborted) {
        response.destroy();
        return { status: 499, code: 'aborted' };
      }
      const status = response.statusCode ?? 502;
      const passed: OutgoingHttpHeaders = {};
      for (const name of PASSED_RESPONSE_HEADERS) {
        const value = response.headers[name];
        if (typeof value === 'string') passed[name] = value;
      }

      if (method === 'HEAD') {
        response.resume();
        res.writeHead(status, passed).end();
        return { status };
      }

      const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
      const sniffable = status === 200 && (encoding === 'identity' || DECODABLE.has(encoding));
      let prefix: Buffer[] = [];
      if (sniffable) {
        const sniffed = await sniffBody(response, encoding, config.limits.playlistMaxBytes);
        if (sniffed.kind === 'too-large') throw new Refusal(502, 'playlist-too-large');
        if (sniffed.kind === 'failed') {
          response.destroy();
          if (controller.signal.aborted) return { status: 499, code: 'aborted' };
          throw new Refusal(502, 'upstream-unreachable');
        }
        if (sniffed.kind === 'hls') {
          const base = publicBaseFor(req, config);
          const body = Buffer.from(
            rewritePlaylist(sniffed.text, finalUrl, (absolute) =>
              buildProxyUrl(base, config.token, absolute, grants.issue(absolute)),
            ),
            'utf8',
          );
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': String(body.length),
          });
          res.end(body);
          return { status: 200, bytes: body.length };
        }
        prefix = sniffed.prefix;
      }

      res.writeHead(status, passed);
      let bytes = 0;
      for (const chunk of prefix) {
        bytes += chunk.length;
        res.write(chunk);
      }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      try {
        await pipeline(response, res);
      } catch (error) {
        if (!controller.signal.aborted)
          logger.log({ event: 'upstream-error', code: errorCode(error) });
        return {
          status,
          code: controller.signal.aborted ? 'aborted' : 'stream-interrupted',
          bytes,
        };
      }
      return { status, bytes };
    } finally {
      res.off('close', onClientClose);
      upstreamAborts.delete(controller);
      active--;
    }
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ status: number; code?: string; bytes?: number }> {
    const method = req.method ?? '';
    const target = req.url ?? '';
    const queryAt = target.indexOf('?');
    const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
    const parsed = pathname.startsWith('/')
      ? parseProxyPath(pathname)
      : ({ ok: false, error: 'not-found' } as const);
    const verdict = evaluateOrigin(req.headers.origin, config.allowedOrigins);
    setBaseHeaders(res, verdict);

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      throw new Refusal(405, 'method-not-allowed');
    }
    if (!parsed.ok && parsed.error === 'not-found') throw new Refusal(404, 'not-found');
    if (verdict.kind === 'forbidden') throw new Refusal(403, 'origin-not-allowed');
    if (method === 'OPTIONS') {
      if (
        verdict.kind === 'allowed' &&
        typeof req.headers['access-control-request-method'] === 'string'
      ) {
        writePreflight(req, res);
      } else {
        res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' }).end();
      }
      return { status: 204 };
    }
    if (!rateLimiter.take()) throw new Refusal(429, 'rate-limited');
    if (badTokens.isLocked()) throw new Refusal(429, 'rate-limited');
    if (!tokenMatches(config.token, parsed.token)) {
      badTokens.recordFailure();
      throw new Refusal(401, 'bad-token');
    }
    if (!parsed.ok) throw new Refusal(400, 'malformed');
    const { route } = parsed;

    if (route.kind === 'health') {
      const body: Record<string, unknown> = {
        service: 'simple-iptv-proxy',
        api: API_VERSION,
        activeUpstreams: active,
      };
      if (route.target !== undefined) {
        const checked = parseUpstreamUrl(route.target);
        if (!checked.ok) throw new Refusal(400, 'bad-url');
        body.upstreamAllowed = isHostAllowed(checked.url.hostname, config.upstream.allowedHosts);
      }
      const json = Buffer.from(JSON.stringify(body), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(json.length),
      });
      res.end(method === 'HEAD' ? undefined : json);
      return { status: 200 };
    }

    const checked = parseUpstreamUrl(route.target);
    if (!checked.ok) throw new Refusal(400, 'bad-url');
    if (route.kind === 'u' && !isHostAllowed(checked.url.hostname, config.upstream.allowedHosts)) {
      throw new Refusal(403, 'host-not-allowed');
    }
    // A grant covers the exact URL text it was issued for (the decoded b64u value).
    if (route.kind === 'g' && !grants.verify(route.grant, route.target)) {
      throw new Refusal(403, 'bad-grant');
    }
    return relay(req, res, checked.url);
  }

  const server = createServer((req, res) => {
    const started = now();
    const done = (status: number, code?: string, bytes?: number) =>
      logger.log({
        event: 'request',
        status,
        ...(code === undefined ? {} : { code }),
        durationMs: now() - started,
        ...(bytes === undefined ? {} : { bytes }),
      });
    handle(req, res).then(
      (outcome) => done(outcome.status, outcome.code, outcome.bytes),
      (error: unknown) => {
        if (error instanceof Refusal) {
          if (!res.headersSent) {
            refuse(res, error, error.status === 405 ? { Allow: 'GET, HEAD, OPTIONS' } : {});
          } else res.destroy();
          done(error.status, error.code);
          return;
        }
        logger.log({ event: 'server-error', code: errorCode(error) });
        if (!res.headersSent) refuse(res, new Refusal(502, 'proxy-error'));
        else res.destroy();
        done(502, 'proxy-error');
      },
    );
  });
  // Slow clients must send their request headers in time (GET/HEAD requests have no body; the
  // long-lived part is the response, bounded by the upstream idle timeout instead).
  server.headersTimeout = 20_000;
  // This is not a forward proxy: CONNECT tunnels are refused (and the token is never checked).
  server.on('connect', (_req, socket) => {
    socket.end(
      `HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD, OPTIONS\r\n${ERROR_HEADER}: method-not-allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    logger.log({ event: 'request', status: 405, code: 'method-not-allowed' });
  });
  server.on('clientError', (error, socket) => {
    logger.log({ event: 'server-error', code: errorCode(error) });
    if (socket.writable)
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });

  return {
    server,
    activeUpstreams: () => active,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const controller of upstreamAborts) controller.abort();
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}
