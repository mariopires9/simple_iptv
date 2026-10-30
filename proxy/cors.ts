// CORS and response security headers (PRX-01).
//
// Requests without an Origin header (a <video> element, curl) are allowed: the token protects the
// proxy, CORS only decides which web pages may read responses. A request with an Origin that is
// not configured is refused outright (403), not just left without CORS headers.
import type { IncomingMessage, ServerResponse } from 'node:http';

export const ERROR_HEADER = 'X-Simple-Iptv-Proxy-Error';
const EXPOSED_HEADERS = `Content-Length, Content-Range, Accept-Ranges, Content-Type, ${ERROR_HEADER}`;

export type OriginVerdict =
  { kind: 'none' } | { kind: 'allowed'; origin: string } | { kind: 'forbidden' };

export function evaluateOrigin(
  header: string | string[] | undefined,
  allowedOrigins: readonly string[],
): OriginVerdict {
  if (header === undefined) return { kind: 'none' };
  if (typeof header !== 'string') return { kind: 'forbidden' };
  return allowedOrigins.includes(header)
    ? { kind: 'allowed', origin: header }
    : { kind: 'forbidden' };
}

/** Headers present on every proxy response. */
export function setBaseHeaders(res: ServerResponse, verdict: OriginVerdict): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Vary', 'Origin');
  if (verdict.kind === 'allowed') {
    res.setHeader('Access-Control-Allow-Origin', verdict.origin);
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  }
}

/** Preflight answer for an allowed origin (204). */
export function writePreflight(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  res.writeHead(204).end();
}
