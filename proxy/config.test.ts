// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ConfigError,
  defaultConfigPath,
  isHostAllowed,
  loadConfig,
  parseHostRule,
  validateConfig,
} from './config.ts';

const TOKEN = 'cfg-token-0123456789-abcdefghijklmnopqrs';
const example = JSON.parse(
  readFileSync(new URL('./config.example.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
type Draft = Record<string, unknown> & {
  listen: Record<string, unknown>;
  upstream: Record<string, unknown>;
  limits: Record<string, unknown>;
};
const valid = () => structuredClone({ ...example, token: TOKEN }) as unknown as Draft;

const dir = mkdtempSync(join(tmpdir(), 'proxy-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('validateConfig', () => {
  it('refuses the shipped example until a real token is pasted', () => {
    expect(() => validateConfig(example)).toThrow(/"token"/);
    const config = validateConfig(valid());
    expect(config.listen).toEqual({ host: '127.0.0.1', port: 8787 });
    expect(config.upstream.allowedHosts).toEqual([
      { host: 'panel.example.com', wildcard: false },
      { host: 'example.net', wildcard: true },
    ]);
    expect(config.limits.playlistMaxBytes).toBe(4 * 1024 * 1024);
    expect(config.grantTtlSeconds).toBe(86_400);
  });

  it('applies defaults for optional sections', () => {
    const config = validateConfig({
      token: TOKEN,
      allowedOrigins: ['https://user.github.io'],
      upstream: { allowedHosts: ['panel.example.com'] },
    });
    expect(config.listen.port).toBe(8787);
    expect(config.upstream.maxRedirects).toBe(5);
    expect(config.upstream.headersTimeoutMs).toBe(15_000);
    expect(config.limits.maxConcurrentUpstreams).toBe(8);
  });

  const refusals: Array<[string, (c: Draft) => void]> = [
    ['a short token', (c) => (c.token = 'short')],
    ['a token with spaces', (c) => (c.token = `${TOKEN} x`)],
    ['empty allowedHosts', (c) => (c.upstream.allowedHosts = [])],
    ['missing upstream', (c) => Reflect.deleteProperty(c, 'upstream')],
    ['empty allowedOrigins', (c) => (c.allowedOrigins = [])],
    ['an origin with a trailing slash', (c) => (c.allowedOrigins = ['https://user.github.io/'])],
    ['an origin with a path', (c) => (c.allowedOrigins = ['https://user.github.io/simple_iptv'])],
    ['a wildcard origin', (c) => (c.allowedOrigins = ['*'])],
    ['a non-loopback listen host', (c) => (c.listen.host = '0.0.0.0')],
    ['a LAN listen host', (c) => (c.listen.host = '192.168.1.10')],
    ['a host name as listen host', (c) => (c.listen.host = 'localhost')],
    ['an unknown key (typo)', (c) => (c.allowedHost = ['x'])],
    ['a bare wildcard', (c) => (c.upstream.allowedHosts = ['*'])],
    ['a TLD wildcard', (c) => (c.upstream.allowedHosts = ['*.com'])],
    ['a host with a scheme', (c) => (c.upstream.allowedHosts = ['http://panel.example.com'])],
    ['a host with a port', (c) => (c.upstream.allowedHosts = ['panel.example.com:8080'])],
    ['a host with a path', (c) => (c.upstream.allowedHosts = ['panel.example.com/x'])],
    ['an out-of-range limit', (c) => (c.limits.maxConcurrentUpstreams = 0)],
    ['a non-integer timeout', (c) => (c.upstream.headersTimeoutMs = '15000')],
    ['a publicBaseUrl with a query', (c) => (c.publicBaseUrl = 'https://pc.ts.net/?a=1')],
  ];
  it.each(refusals)('refuses %s', (_label, mutate) => {
    const config = valid();
    mutate(config);
    expect(() => validateConfig(config)).toThrow(ConfigError);
  });

  it('never echoes configured values in error messages', () => {
    const config = valid();
    config.upstream.allowedHosts = ['secret-panel.example.com:1234'];
    config.token = 'leaky token value';
    for (const mutate of [
      () => validateConfig(config),
      () => validateConfig({ ...valid(), upstream: config.upstream }),
    ]) {
      try {
        mutate();
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain('secret-panel');
        expect(String(error)).not.toContain('leaky');
      }
    }
  });

  it('accepts ::1 as listen host and IP/IDN allowlist entries', () => {
    const config = valid();
    config.listen.host = '::1';
    config.upstream.allowedHosts = [
      '203.0.113.5',
      '[2001:db8::1]',
      'bücher.example',
      'Panel.Example.com',
    ];
    const parsed = validateConfig(config);
    expect(parsed.upstream.allowedHosts.map((r) => r.host)).toEqual([
      '203.0.113.5',
      '[2001:db8::1]',
      'xn--bcher-kva.example',
      'panel.example.com',
    ]);
  });
});

describe('host rules', () => {
  const rules = ['panel.example.com', '*.example.net'].map((h) => parseHostRule(h)!);
  it.each([
    ['panel.example.com', true],
    ['PANEL.example.com', true],
    ['edge1.example.net', true],
    ['a.b.example.net', true],
    ['example.net', false],
    ['evil-example.net', false],
    ['panel.example.com.evil.test', false],
    ['xpanel.example.com', false],
  ])('%s → %s', (host, allowed) => {
    expect(isHostAllowed(host, rules)).toBe(allowed);
  });
});

describe('loading', () => {
  it('reads a file (BOM tolerated) and refuses unreadable or invalid JSON', () => {
    const good = join(dir, 'good.json');
    writeFileSync(good, `\ufeff${JSON.stringify(valid())}`);
    expect(loadConfig(good).token).toBe(TOKEN);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(() => loadConfig(bad)).toThrow(/not valid JSON/);
    expect(() => loadConfig(join(dir, 'missing.json'))).toThrow(/cannot read/);
  });

  it('uses %APPDATA% on Windows and XDG elsewhere', () => {
    expect(
      defaultConfigPath('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me'),
    ).toBe(join('C:\\Users\\me\\AppData\\Roaming', 'SimpleIPTVProxy', 'config.json'));
    expect(defaultConfigPath('linux', {}, '/home/me')).toBe(
      '/home/me/.config/simple-iptv-proxy/config.json',
    );
    expect(defaultConfigPath('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe(
      '/xdg/simple-iptv-proxy/config.json',
    );
  });
});
