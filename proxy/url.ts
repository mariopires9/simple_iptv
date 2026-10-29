// Shared URL contract of the personal proxy (PRX-01, ADR-010).
//
// This module is pure: no `node:` imports, only TextEncoder/TextDecoder/btoa/atob, so the app can
// import it from its tests and mirror the exact same scheme. Proxy URL shapes (B = configured
// proxy base URL without a trailing slash; a path prefix is allowed):
//
//   B/v1/<token>/health
//   B/v1/<token>/health/<b64u(url)>
//   B/v1/<token>/u/<b64u(url)>/<name>          built by the app (upstream host must be allowlisted)
//   B/v1/<token>/g/<grant>/<b64u(url)>/<name>  built only by the proxy inside rewritten playlists
//
// b64u is unpadded base64url of the UTF-8 absolute http(s) URL; <name> is cosmetic (players
// sniff extensions) and ignored by the proxy. There are no query strings in the scheme.

/** Version segment of every proxy path. */
export const API_PREFIX = 'v1';
/** API version reported by the health endpoint. */
export const API_VERSION = 1;
/** Maximum length, in UTF-8 bytes, of a decoded upstream URL. */
export const MAX_URL_BYTES = 8192;
/** Token syntax: generated as 32 random bytes in base64url (43 characters). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
/** Grant syntax: `<expiry epoch seconds, base36>.<first 22 chars of b64u(HMAC-SHA256)>`. */
export const GRANT_PATTERN = /^[0-9a-z]{1,11}\.[A-Za-z0-9_-]{22}$/;

const B64U_PATTERN = /^[A-Za-z0-9_-]+$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_B64U_LENGTH = Math.ceil((MAX_URL_BYTES * 4) / 3);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Unpadded base64url of raw bytes. */
export function bytesToB64u(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unpadded base64url of the UTF-8 encoding of `text`. */
export function b64uEncode(text: string): string {
  return bytesToB64u(encoder.encode(text));
}

/**
 * Decodes unpadded base64url into UTF-8 text. Returns `null` for anything malformed: characters
 * outside the alphabet, padding, a non-canonical encoding, invalid UTF-8 or more than
 * {@link MAX_URL_BYTES} decoded bytes.
 */
export function b64uDecode(value: string): string | null {
  if (value.length === 0 || value.length > MAX_B64U_LENGTH) return null;
  if (!B64U_PATTERN.test(value) || value.length % 4 === 1) return null;
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  if (binary.length > MAX_URL_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Canonical form only, so one URL has exactly one proxy path.
  if (bytesToB64u(bytes) !== value) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export type UpstreamUrlError = 'bad-url' | 'bad-scheme' | 'userinfo' | 'too-long';
export type UpstreamUrlResult = { ok: true; url: URL } | { ok: false; error: UpstreamUrlError };

/**
 * Validates an absolute upstream URL: http/https only, no userinfo, no whitespace or control
 * characters, at most {@link MAX_URL_BYTES} bytes. The fragment is dropped.
 */
export function parseUpstreamUrl(text: string): UpstreamUrlResult {
  if (encoder.encode(text).length > MAX_URL_BYTES) return { ok: false, error: 'too-long' };
  // The URL parser silently strips tabs/newlines; refuse them instead.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(text)) return { ok: false, error: 'bad-url' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'bad-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'bad-scheme' };
  }
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'userinfo' };
  if (url.hostname === '') return { ok: false, error: 'bad-url' };
  url.hash = '';
  return { ok: true, url };
}

/**
 * The cosmetic last path segment: the upstream URL's last non-empty path segment when it matches
 * `[A-Za-z0-9._-]{1,64}` (and is not made of dots only), otherwise `_`.
 */
export function sanitizeName(upstreamUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(upstreamUrl).pathname;
  } catch {
    return '_';
  }
  const segments = pathname.split('/').filter((s) => s !== '');
  const last = segments.at(-1) ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    return '_';
  }
  if (!NAME_PATTERN.test(decoded) || /^\.+$/.test(decoded)) return '_';
  return decoded;
}

/** Strips trailing slashes from a configured proxy base URL. */
export function normalizeProxyBase(base: string): string {
  return base.replace(/\/+$/, '');
}

/**
 * Builds a proxy URL for `upstreamUrl`. Without `grant` it is a `u` URL (what the app builds);
 * with a grant it is a `g` URL (what the proxy writes into rewritten playlists).
 */
export function buildProxyUrl(
  base: string,
  token: string,
  upstreamUrl: string,
  grant?: string,
): string {
  const root = `${normalizeProxyBase(base)}/${API_PREFIX}/${token}`;
  const encoded = b64uEncode(upstreamUrl);
  const name = sanitizeName(upstreamUrl);
  return grant === undefined
    ? `${root}/u/${encoded}/${name}`
    : `${root}/g/${grant}/${encoded}/${name}`;
}

/** Builds the health URL, optionally asking whether `upstreamUrl` would be allowed. */
export function buildHealthUrl(base: string, token: string, upstreamUrl?: string): string {
  const root = `${normalizeProxyBase(base)}/${API_PREFIX}/${token}/health`;
  return upstreamUrl === undefined ? root : `${root}/${b64uEncode(upstreamUrl)}`;
}

export type ProxyRoute =
  | { kind: 'health'; target?: string }
  | { kind: 'u'; target: string }
  | { kind: 'g'; grant: string; target: string };

export type ParsedProxyPath =
  /** Not a `/v1/` path at all (HTTP 404). */
  | { ok: false; error: 'not-found' }
  /** A `/v1/<token>/…` path whose remainder is malformed (HTTP 400, after the token check). */
  | { ok: false; error: 'malformed'; token: string }
  | { ok: true; token: string; route: ProxyRoute };

/**
 * Parses the path of an incoming proxy request (`pathname` relative to the proxy base, query
 * string already removed). The token is returned as-is for the caller to verify first; `target`
 * values are decoded but not yet validated as URLs (see {@link parseUpstreamUrl}).
 */
export function parseProxyPath(pathname: string): ParsedProxyPath {
  const prefix = `/${API_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return { ok: false, error: 'not-found' };
  const [token = '', kind, ...rest] = pathname.slice(prefix.length).split('/');
  const malformed = { ok: false, error: 'malformed', token } as const;
  if (token === '') return malformed;
  const decode = (segment: string | undefined): string | null =>
    segment === undefined ? null : b64uDecode(segment);
  const validName = (segment: string | undefined): boolean =>
    segment !== undefined && NAME_PATTERN.test(segment);

  switch (kind) {
    case 'health': {
      if (rest.length === 0) return { ok: true, token, route: { kind: 'health' } };
      const target = rest.length === 1 ? decode(rest[0]) : null;
      return target === null ? malformed : { ok: true, token, route: { kind: 'health', target } };
    }
    case 'u': {
      const target = rest.length === 2 && validName(rest[1]) ? decode(rest[0]) : null;
      return target === null ? malformed : { ok: true, token, route: { kind: 'u', target } };
    }
    case 'g': {
      const grant = rest[0] ?? '';
      if (rest.length !== 3 || !GRANT_PATTERN.test(grant) || !validName(rest[2])) return malformed;
      const target = decode(rest[1]);
      return target === null ? malformed : { ok: true, token, route: { kind: 'g', grant, target } };
    }
    default:
      return malformed;
  }
}
