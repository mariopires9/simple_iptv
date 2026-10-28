// External URL validation (SEC-01, docs/SECURITY.md §3). Every URL that comes from the user or
// from a list/API (source, stream, logo, EPG, external link) goes through parseExternalUrl before
// it is fetched, played, rendered or linked.

/** Where the URL will be used. `link` is a clickable link to a third-party page. */
export type ExternalUrlPurpose = 'source' | 'stream' | 'image' | 'epg' | 'link';

/** Reason codes; the UI maps them to localized messages. */
export type ExternalUrlRejection = 'empty' | 'invalid' | 'scheme' | 'too-long';

export type ExternalUrlResult =
  { ok: true; url: URL } | { ok: false; reason: ExternalUrlRejection };

/** Maximum URL length in characters (8 KB), both for the input and the normalized href. */
export const MAX_EXTERNAL_URL_LENGTH = 8 * 1024;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// C0 controls, DEL and C1 controls. The WHATWG URL parser silently strips tabs/newlines anywhere
// and C0 controls at the edges ("java\tscript:" parses as "javascript:"), so any control character
// is rejected outright: a legitimate URL never contains one.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validates an external URL. Only absolute `http:`/`https:` URLs with a host are accepted; the
 * input is trimmed first. Relative URLs are `invalid` (they would resolve against the app origin).
 *
 * `purpose: 'link'` additionally rejects URLs with userinfo (`https://trusted.example@evil.test`
 * is a classic phishing disguise and a third-party page never needs credentials). For the other
 * purposes userinfo is accepted because some IPTV servers need it; use {@link displayUrl} to show
 * such URLs.
 */
export function parseExternalUrl(input: string, purpose: ExternalUrlPurpose): ExternalUrlResult {
  if (input.length > MAX_EXTERNAL_URL_LENGTH) return { ok: false, reason: 'too-long' };
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  if (CONTROL_CHARS.test(trimmed)) return { ok: false, reason: 'invalid' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'scheme' };
  if (url.hostname === '') return { ok: false, reason: 'invalid' };
  if (url.href.length > MAX_EXTERNAL_URL_LENGTH) return { ok: false, reason: 'too-long' };
  if (purpose === 'link' && (url.username !== '' || url.password !== '')) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, url };
}

/**
 * Display form of a URL: scheme, host, port and path only. Userinfo, query and fragment are never
 * shown, e.g. `http://user:pass@host:8080/path?token=x#y` → `http://host:8080/path`.
 * A bare root path is omitted (`https://host`).
 *
 * Note: Xtream stream URLs carry credentials in the path (`/live/<user>/<pass>/1.ts`); for those,
 * use `shortenUrl` (masks every path segment) instead.
 */
export function displayUrl(url: URL): string {
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.protocol}//${url.host}${path}`;
}

export interface SafeExternalLink {
  href: string;
  rel: 'noopener noreferrer';
  target: '_blank';
}

/**
 * Props for an `<a>` pointing to a third-party page (e.g. a trailer), or `undefined` when the URL
 * is not a safe http(s) link. Callers still ask the user for confirmation before navigating (SEC-01
 * AC4).
 */
export function safeExternalLink(input: string): SafeExternalLink | undefined {
  const result = parseExternalUrl(input, 'link');
  if (!result.ok) return undefined;
  return { href: result.url.href, rel: 'noopener noreferrer', target: '_blank' };
}
