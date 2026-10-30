// Token and playlist grants (PRX-01).
//
// The token is the only credential of the proxy: it is in every proxy path. Grants let the proxy
// serve URLs it wrote into rewritten HLS playlists (segments, keys, renditions on edge hosts that
// are not allowlisted) without trusting the client: a grant is an expiring HMAC over the exact
// upstream URL, keyed by a key derived from the token, so rotating the token invalidates them all.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GRANT_PATTERN, TOKEN_PATTERN, bytesToB64u } from './url.ts';

const GRANT_KEY_LABEL = 'simple-iptv-proxy grant v1';
const GRANT_MAC_LENGTH = 22;

/** A new token: 32 random bytes as unpadded base64url (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isValidTokenSyntax(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time token comparison (digests have equal length whatever the inputs are). */
export function tokenMatches(expected: string, candidate: string): boolean {
  return timingSafeEqual(sha256(expected), sha256(candidate));
}

export interface GrantSigner {
  /** A grant for `url` (the exact upstream URL text that will be b64u-encoded). */
  issue(url: string): string;
  /** True when `grant` was issued for `url` with this token and has not expired. */
  verify(grant: string, url: string): boolean;
}

/**
 * Grant = `<expiry>.<mac>` where expiry is the epoch second (base36) and mac is the first 22
 * characters of b64u(HMAC-SHA256(Kg, expiry + "\n" + url)), with the expiry in its base36 form
 * and Kg = HMAC-SHA256(key = token, "simple-iptv-proxy grant v1").
 */
export function createGrantSigner(
  token: string,
  ttlSeconds: number,
  now: () => number = Date.now,
): GrantSigner {
  const key = createHmac('sha256', token).update(GRANT_KEY_LABEL, 'utf8').digest();
  const mac = (expiry: string, url: string): string =>
    bytesToB64u(createHmac('sha256', key).update(`${expiry}\n${url}`, 'utf8').digest()).slice(
      0,
      GRANT_MAC_LENGTH,
    );
  const nowSeconds = () => Math.floor(now() / 1000);

  return {
    issue(url) {
      const expiry = (nowSeconds() + ttlSeconds).toString(36);
      return `${expiry}.${mac(expiry, url)}`;
    },
    verify(grant, url) {
      if (!GRANT_PATTERN.test(grant)) return false;
      const [expiry = '', given = ''] = grant.split('.');
      const expected = mac(expiry, url);
      const valid = timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      return valid && parseInt(expiry, 36) > nowSeconds();
    },
  };
}
