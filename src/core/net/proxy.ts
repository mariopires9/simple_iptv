// Personal proxy URL contract, app side (PRX-01, ADR-010). The standalone relay in proxy/
// implements the same contract on the server side; src never imports it.
//
// Base B = the configured proxy URL, normalized by `parseProxyBaseUrl` (https only, or http for a
// loopback host; no user info, query or fragment; trailing slashes stripped; a path prefix is
// allowed). Requests are rewritten to
//   B/v1/<token>/u/<b64u(url)>/<name>
// where b64u is the unpadded base64url of the UTF-8 absolute URL (at most 8 KiB decoded) and
// <name> is the upstream URL's last path segment when it matches [A-Za-z0-9._-]{1,64}, else `_`
// (it only gives players a file name/extension to look at). Health check:
//   GET B/v1/<token>/health[/<b64u(serverUrl)>]
// → 200 JSON { service: "simple-iptv-proxy", api: 1, activeUpstreams, upstreamAllowed? }.
//
// The token is a secret: `createProxyRewriter` registers it with the log redactor, and
// `shortenUrl` masks every path segment of a proxy URL (none of them is a known first segment).
import { registerSecret } from '@/core/log';
import type { RequestPurpose, UrlRewriter } from './http';

/** API version of the proxy contract (the `/v1/` path segment and `api` in the health JSON). */
export const PROXY_API_VERSION = 1;
export const PROXY_SERVICE_NAME = 'simple-iptv-proxy';
/** Response header the proxy sets on its own errors (as opposed to upstream errors). */
export const PROXY_ERROR_HEADER = 'X-Simple-Iptv-Proxy-Error';
/** Largest upstream URL the proxy accepts (UTF-8 bytes, before encoding). */
export const MAX_PROXY_TARGET_BYTES = 8 * 1024;
/** Longest proxy base URL accepted in the settings. */
export const MAX_PROXY_BASE_URL_LENGTH = 2048;

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

export type ProxyBaseUrlRejection =
  'empty' | 'invalid' | 'too-long' | 'insecure' | 'credentials' | 'query';

export type ProxyBaseUrlResult =
  { ok: true; baseUrl: string } | { ok: false; reason: ProxyBaseUrlRejection };

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Validates and normalizes the proxy base URL typed by the user. `http:` is accepted only for a
 * loopback host (a secure context for browsers, e.g. the proxy on the same PC during development);
 * anything else must be `https:` (an http proxy would be blocked as mixed content anyway).
 */
export function parseProxyBaseUrl(input: string): ProxyBaseUrlResult {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'empty' };
  if (raw.length > MAX_PROXY_BASE_URL_LENGTH) return { ok: false, reason: 'too-long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'invalid' };
  if (url.hostname === '') return { ok: false, reason: 'invalid' };
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return { ok: false, reason: 'insecure' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  // `new URL` drops an empty `?` / `#`: look at the raw text too.
  if (url.search !== '' || url.hash !== '' || /[?#]/.test(raw)) {
    return { ok: false, reason: 'query' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, baseUrl: `${url.protocol}//${url.host}${path}` };
}

export function isValidProxyToken(token: string): boolean {
  return TOKEN.test(token);
}

/** Unpadded base64url of the UTF-8 bytes of `text`. */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `<name>` segment: the upstream URL's last path segment when safe, else `_`. */
export function proxyTargetName(url: URL): string {
  const last = url.pathname.split('/').pop() ?? '';
  return NAME.test(last) ? last : '_';
}

export interface ProxyRewriterOptions {
  /** Normalized base URL (`parseProxyBaseUrl`). */
  baseUrl: string;
  token: string;
  /** Purposes routed through the proxy. `image` is never routed. */
  purposes: Iterable<RequestPurpose>;
}

/**
 * Rewriter that sends the given purposes through the proxy. Left unchanged: other purposes,
 * non-http(s) URLs (blob:, data:…), URLs already pointing at the proxy (`B/v1/…`, the absolute
 * child URLs of playlists the proxy rewrote) and URLs too long for the proxy.
 */
export function createProxyRewriter({
  baseUrl,
  token,
  purposes,
}: ProxyRewriterOptions): UrlRewriter {
  registerSecret(token);
  const routed = new Set(purposes);
  routed.delete('image');
  const prefix = `${baseUrl}/v1/`;
  return {
    rewrite(url, purpose) {
      if (!routed.has(purpose)) return url;
      if (!/^https?:/i.test(url) || url.startsWith(prefix)) return url;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return url;
      }
      if (parsed.href.startsWith(prefix)) return url;
      if (new TextEncoder().encode(url).length > MAX_PROXY_TARGET_BYTES) return url;
      return `${prefix}${token}/u/${encodeBase64Url(url)}/${proxyTargetName(parsed)}`;
    },
  };
}

/** Health check URL; with `probeUrl`, the proxy also says whether that upstream is allowed. */
export function proxyHealthUrl(baseUrl: string, token: string, probeUrl?: string): string {
  const health = `${baseUrl}/v1/${token}/health`;
  return probeUrl === undefined ? health : `${health}/${encodeBase64Url(probeUrl)}`;
}

export interface ProxyHealth {
  activeUpstreams: number;
  /** Only when a probe URL was sent. */
  upstreamAllowed?: boolean;
}

/** Validates the (untrusted) health JSON; `undefined` when it is not this proxy's answer. */
export function parseProxyHealth(body: unknown): ProxyHealth | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const { service, api, activeUpstreams, upstreamAllowed } = body as Record<string, unknown>;
  if (service !== PROXY_SERVICE_NAME || api !== PROXY_API_VERSION) return undefined;
  if (
    typeof activeUpstreams !== 'number' ||
    !Number.isInteger(activeUpstreams) ||
    activeUpstreams < 0
  ) {
    return undefined;
  }
  const health: ProxyHealth = { activeUpstreams };
  if (typeof upstreamAllowed === 'boolean') health.upstreamAllowed = upstreamAllowed;
  return health;
}
