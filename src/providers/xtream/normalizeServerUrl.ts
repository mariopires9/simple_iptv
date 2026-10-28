// Normalizes the server address typed by the user to the panel base URL `scheme://host[:port]`
// (SRC-02 AC1). Validation follows parseExternalUrl (SEC-01): only http/https, no userinfo.
import { parseExternalUrl, type ExternalUrlRejection } from '@/core/net';

export type ServerUrlResult =
  { ok: true; baseUrl: string; url: URL } | { ok: false; reason: ExternalUrlRejection };

/** Thrown by {@link createXtreamClient} when the server address is not acceptable. */
export class InvalidServerUrlError extends Error {
  override readonly name = 'InvalidServerUrlError';
  readonly reason: ExternalUrlRejection;

  constructor(reason: ExternalUrlRejection) {
    // Never include the input: it may contain credentials.
    super(`Invalid server URL (${reason})`);
    this.reason = reason;
  }
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/**
 * `javascript:…`, `data:…`: a scheme not followed by `//`, not a `host:port`, not a bare `host:`
 * or `host:/path` (empty port) and not userinfo (`user:pass@host`, which must be reported as
 * `credentials`).
 */
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:(?![\d/]|$)(?![^/]*@)/i;

/**
 * `example.test:8080`, `http://example.test:8080/`, `HTTP://Example.test:8080/player_api.php?x=1`
 * → `http://example.test:8080`. Without a scheme, `http:` is assumed (most panels are HTTP-only).
 * Path, query and fragment are dropped; default ports are omitted by the URL parser
 * (`http://host:80` → `http://host`). A trailing colon with no port (`host:`) is accepted as an
 * empty port and dropped (`http://host`), as the URL parser does for `http://host:`.
 */
export function normalizeServerUrl(input: string): ServerUrlResult {
  const trimmed = input.trim();
  let candidate = trimmed;
  if (trimmed.startsWith('//')) candidate = `http:${trimmed}`;
  else if (trimmed !== '' && !HAS_SCHEME.test(trimmed) && !OPAQUE_SCHEME.test(trimmed)) {
    candidate = `http://${trimmed}`;
  }

  const parsed = parseExternalUrl(candidate, 'source');
  if (!parsed.ok) return parsed;
  const url = new URL(parsed.url.origin);
  return { ok: true, baseUrl: url.origin, url };
}

/** Like {@link normalizeServerUrl} but throws {@link InvalidServerUrlError}. */
export function assertServerUrl(input: string): string {
  const result = normalizeServerUrl(input);
  if (!result.ok) throw new InvalidServerUrlError(result.reason);
  return result.baseUrl;
}
