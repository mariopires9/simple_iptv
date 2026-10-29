// Proxy configuration: a hand-validated JSON file that fails closed (PRX-01).
//
// Error messages name the offending field only — never its value — because they are printed to
// the console and the file holds the token and the provider hosts.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TOKEN_PATTERN } from './url.ts';

export interface HostRule {
  /** Normalized host name (lowercase, punycode, IPv6 in brackets). */
  host: string;
  /** `*.example.net`: matches any subdomain of `host`, not `host` itself. */
  wildcard: boolean;
}

export interface ProxyConfig {
  listen: { host: string; port: number };
  token: string;
  allowedOrigins: string[];
  /** Fixed public base URL for rewritten playlists; otherwise derived per request. */
  publicBaseUrl?: string;
  upstream: {
    allowedHosts: HostRule[];
    maxRedirects: number;
    headersTimeoutMs: number;
    idleTimeoutMs: number;
  };
  limits: {
    requestsPerMinute: number;
    maxConcurrentUpstreams: number;
    badTokenPerMinute: number;
    playlistMaxBytes: number;
  };
  grantTtlSeconds: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkKeys(object: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(`${where} has an unknown key (allowed: ${allowed.join(', ')})`);
    }
  }
}

function section(parent: Json, key: string, keys: readonly string[], required: boolean): Json {
  const value = parent[key];
  if (value === undefined && !required) return {};
  if (!isObject(value)) throw new ConfigError(`"${key}" must be an object`);
  checkKeys(value, keys, `"${key}"`);
  return value;
}

function integer(
  object: Json,
  key: string,
  where: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = object[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${where}.${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Loopback IP literals only: the proxy is meant to sit behind Tailscale Serve on the same PC. */
function isLoopbackHost(host: string): boolean {
  return /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host) || host === '::1';
}

/** Parses an allowlist entry: an exact host or `*.` followed by a host with at least one dot. */
export function parseHostRule(entry: string): HostRule | null {
  const wildcard = entry.startsWith('*.');
  const raw = wildcard ? entry.slice(2) : entry;
  if (raw === '' || /[\s/?#@\\*]/.test(raw)) return null;
  let host: string;
  try {
    const url = new URL(`http://${raw}`);
    if (url.port !== '' || url.pathname !== '/' || url.username !== '') return null;
    host = url.hostname;
  } catch {
    return null;
  }
  if (host !== raw.toLowerCase() && !/[\u0080-\uffff]/.test(raw)) return null;
  if (host.endsWith('.')) return null;
  if (wildcard && (!host.includes('.') || host.startsWith('['))) return null;
  return { host, wildcard };
}

/** True when `hostname` (a WHATWG `URL.hostname`) matches one of the rules. */
export function isHostAllowed(hostname: string, rules: readonly HostRule[]): boolean {
  const host = hostname.toLowerCase();
  return rules.some((rule) =>
    rule.wildcard ? host.endsWith(`.${rule.host}`) : host === rule.host,
  );
}

function bareOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin === value ? value : null;
  } catch {
    return null;
  }
}

function publicBase(value: unknown): string {
  const fail = () =>
    new ConfigError(
      '"publicBaseUrl" must be an http(s) URL without query, fragment or credentials',
    );
  if (typeof value !== 'string') throw fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fail();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw fail();
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '')
    throw fail();
  if (value.includes('?') || value.includes('#')) throw fail();
  return url.href.replace(/\/+$/, '');
}

/** Validates a parsed JSON value. Throws {@link ConfigError} on the first problem. */
export function validateConfig(raw: unknown): ProxyConfig {
  if (!isObject(raw)) throw new ConfigError('the configuration must be a JSON object');
  checkKeys(
    raw,
    ['listen', 'token', 'allowedOrigins', 'publicBaseUrl', 'upstream', 'limits', 'grantTtlSeconds'],
    'the configuration',
  );

  const listen = section(raw, 'listen', ['host', 'port'], false);
  const listenHost = listen.host ?? '127.0.0.1';
  if (typeof listenHost !== 'string' || !isLoopbackHost(listenHost)) {
    throw new ConfigError('listen.host must be a loopback IP address (127.0.0.1 or ::1)');
  }
  const port = integer(listen, 'port', 'listen', 1, 65535, 8787);

  if (typeof raw.token !== 'string' || !TOKEN_PATTERN.test(raw.token)) {
    throw new ConfigError(
      '"token" must be 32-128 characters of A-Z a-z 0-9 _ - (use --generate-token)',
    );
  }

  if (!Array.isArray(raw.allowedOrigins) || raw.allowedOrigins.length === 0) {
    throw new ConfigError('"allowedOrigins" must be a non-empty array');
  }
  const allowedOrigins = raw.allowedOrigins.map((value, i) => {
    const origin = bareOrigin(value);
    if (origin === null) {
      throw new ConfigError(
        `allowedOrigins[${i}] must be a bare origin such as https://user.github.io (no path or trailing slash)`,
      );
    }
    return origin;
  });

  const upstream = section(
    raw,
    'upstream',
    ['allowedHosts', 'maxRedirects', 'headersTimeoutMs', 'idleTimeoutMs'],
    true,
  );
  if (!Array.isArray(upstream.allowedHosts) || upstream.allowedHosts.length === 0) {
    throw new ConfigError('upstream.allowedHosts must be a non-empty array');
  }
  const allowedHosts = upstream.allowedHosts.map((value, i) => {
    const rule = typeof value === 'string' ? parseHostRule(value) : null;
    if (rule === null) {
      throw new ConfigError(
        `upstream.allowedHosts[${i}] must be a host name or *.domain (no scheme, port or path)`,
      );
    }
    return rule;
  });

  const limits = section(
    raw,
    'limits',
    ['requestsPerMinute', 'maxConcurrentUpstreams', 'badTokenPerMinute', 'playlistMaxBytes'],
    false,
  );

  return {
    listen: { host: listenHost, port },
    token: raw.token,
    allowedOrigins,
    ...(raw.publicBaseUrl === undefined ? {} : { publicBaseUrl: publicBase(raw.publicBaseUrl) }),
    upstream: {
      allowedHosts,
      maxRedirects: integer(upstream, 'maxRedirects', 'upstream', 0, 10, 5),
      headersTimeoutMs: integer(upstream, 'headersTimeoutMs', 'upstream', 1000, 120_000, 15_000),
      idleTimeoutMs: integer(upstream, 'idleTimeoutMs', 'upstream', 1000, 600_000, 30_000),
    },
    limits: {
      requestsPerMinute: integer(limits, 'requestsPerMinute', 'limits', 1, 100_000, 1200),
      maxConcurrentUpstreams: integer(limits, 'maxConcurrentUpstreams', 'limits', 1, 256, 8),
      badTokenPerMinute: integer(limits, 'badTokenPerMinute', 'limits', 1, 1000, 10),
      playlistMaxBytes: integer(
        limits,
        'playlistMaxBytes',
        'limits',
        1024,
        64 * 1024 * 1024,
        4 * 1024 * 1024,
      ),
    },
    grantTtlSeconds: integer(
      raw,
      'grantTtlSeconds',
      'the configuration',
      60,
      7 * 24 * 3600,
      86_400,
    ),
  };
}

/** Default config path: `%APPDATA%\SimpleIPTVProxy\config.json` on Windows, XDG elsewhere. */
export function defaultConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'SimpleIPTVProxy', 'config.json');
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'simple-iptv-proxy', 'config.json');
}

/** Reads and validates the config file. Throws {@link ConfigError}. */
export function loadConfig(path: string): ProxyConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError('cannot read the configuration file (see --config)');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\ufeff/, ''));
  } catch {
    throw new ConfigError('the configuration file is not valid JSON');
  }
  return validateConfig(raw);
}
