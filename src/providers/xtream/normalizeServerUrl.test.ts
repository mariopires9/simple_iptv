import { describe, expect, it } from 'vitest';
import type { ExternalUrlRejection } from '@/core/net';
import { InvalidServerUrlError, assertServerUrl, normalizeServerUrl } from './normalizeServerUrl';

// Fictitious hosts only (CLAUDE.md).
describe('normalizeServerUrl — accepted (AC1)', () => {
  it.each([
    ['example.test:8080', 'http://example.test:8080'],
    ['example.test:8080/', 'http://example.test:8080'],
    ['http://example.test:8080', 'http://example.test:8080'],
    ['http://example.test:8080/', 'http://example.test:8080'],
    ['HTTP://Example.test:8080/player_api.php', 'http://example.test:8080'],
    ['http://example.test:8080/player_api.php/', 'http://example.test:8080'],
    ['http://example.test:8080/player_api.php?username=u&password=p', 'http://example.test:8080'],
    [
      'http://example.test:8080/get.php?username=u&password=p&type=m3u_plus',
      'http://example.test:8080',
    ],
    ['example.test:8080/player_api.php', 'http://example.test:8080'],
    ['example.test', 'http://example.test'],
    ['EXAMPLE.TEST', 'http://example.test'],
    ['  example.test:8080  ', 'http://example.test:8080'],
    ['https://example.test', 'https://example.test'],
    ['HTTPS://Example.Test:8443/', 'https://example.test:8443'],
    ['https://example.test:443/', 'https://example.test'],
    ['http://example.test:80/', 'http://example.test'],
    ['example.test:80', 'http://example.test'],
    ['http://example.test/panel/sub/', 'http://example.test'],
    ['http://example.test:8080#frag', 'http://example.test:8080'],
    ['//example.test:8080/', 'http://example.test:8080'],
    ['192.0.2.10:25461', 'http://192.0.2.10:25461'],
    ['http://192.0.2.10:25461/player_api.php', 'http://192.0.2.10:25461'],
    ['[2001:db8::1]:8000', 'http://[2001:db8::1]:8000'],
    ['https://[2001:db8::1]/', 'https://[2001:db8::1]'],
    ['localhost:8080', 'http://localhost:8080'],
    ['exämple.test:8080', 'http://xn--exmple-cua.test:8080'],
  ])('%j → %s', (input, expected) => {
    const result = normalizeServerUrl(input);
    expect(result).toMatchObject({ ok: true, baseUrl: expected });
    if (result.ok) expect(result.url.origin).toBe(expected);
  });
});

describe('normalizeServerUrl — rejected (AC1)', () => {
  it.each<[string, ExternalUrlRejection]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['http://jdoe:secret@example.test:8080', 'credentials'],
    ['jdoe:secret@example.test:8080', 'credentials'],
    ['jdoe@example.test', 'credentials'],
    ['ftp://example.test', 'scheme'],
    ['rtmp://example.test:1935', 'scheme'],
    ['ws://example.test', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,x', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['example.test:99999', 'invalid'],
    ['http://', 'invalid'],
    ['exa mple.test', 'invalid'],
    ['http://example.test:8080/\u0000', 'invalid'],
    [`example.test/${'a'.repeat(9000)}`, 'too-long'],
  ])('%j → %s', (input, reason) => {
    expect(normalizeServerUrl(input)).toEqual({ ok: false, reason });
  });
});

describe('assertServerUrl', () => {
  it('returns the base URL', () => {
    expect(assertServerUrl('example.test:8080/')).toBe('http://example.test:8080');
  });

  it('throws a typed error without echoing the input', () => {
    const input = 'http://jdoe:secret@example.test:8080';
    let caught: unknown;
    try {
      assertServerUrl(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidServerUrlError);
    expect(caught).toMatchObject({ reason: 'credentials', name: 'InvalidServerUrlError' });
    expect(String(caught)).not.toMatch(/jdoe|secret|example\.test/);
  });
});
