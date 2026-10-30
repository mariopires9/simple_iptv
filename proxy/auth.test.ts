// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGrantSigner, generateToken, isValidTokenSyntax, tokenMatches } from './auth.ts';
import { GRANT_PATTERN, bytesToB64u } from './url.ts';

const TOKEN = 'auth-token-0123456789-abcdefghijklmnopq';
const URL_A = 'http://edge.example.net/hls/seg1.ts';

describe('tokens', () => {
  it('generates 43-character base64url tokens from 32 random bytes', () => {
    const tokens = new Set(Array.from({ length: 20 }, generateToken));
    expect(tokens.size).toBe(20);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isValidTokenSyntax(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('compares tokens exactly', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN.toUpperCase())).toBe(false);
    expect(tokenMatches(TOKEN, '')).toBe(false);
  });
});

describe('grants', () => {
  const at = (ms: number) => () => ms;

  it('follows the documented construction', () => {
    const now = 1_800_000_000_000;
    const grant = createGrantSigner(TOKEN, 3600, at(now)).issue(URL_A);
    expect(grant).toMatch(GRANT_PATTERN);
    const expiry = (now / 1000 + 3600).toString(36);
    const kg = createHmac('sha256', TOKEN).update('simple-iptv-proxy grant v1').digest();
    const mac = bytesToB64u(createHmac('sha256', kg).update(`${expiry}\n${URL_A}`).digest()).slice(
      0,
      22,
    );
    expect(grant).toBe(`${expiry}.${mac}`);
  });

  it('verifies until expiry, for the exact URL and token only', () => {
    let now = 1_800_000_000_000;
    const signer = createGrantSigner(TOKEN, 3600, () => now);
    const grant = signer.issue(URL_A);
    expect(signer.verify(grant, URL_A)).toBe(true);
    expect(signer.verify(grant, `${URL_A}?x`)).toBe(false);
    expect(
      signer.verify(
        grant.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        URL_A,
      ),
    ).toBe(false);
    expect(signer.verify('zzzzzzzzzzz.' + grant.split('.')[1], URL_A)).toBe(false);
    expect(createGrantSigner(`${TOKEN}2`, 3600, () => now).verify(grant, URL_A)).toBe(false);
    now += 3600 * 1000;
    expect(signer.verify(grant, URL_A)).toBe(false);
  });

  it('rejects malformed grants', () => {
    const signer = createGrantSigner(TOKEN, 3600);
    for (const grant of ['', 'abc', 'abc.def', 'ABC.' + 'a'.repeat(22), 'abc.' + 'a'.repeat(23)]) {
      expect(signer.verify(grant, URL_A)).toBe(false);
    }
  });
});
