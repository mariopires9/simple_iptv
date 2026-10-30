// Personal proxy configuration and the per-list rewriters (PRX-01, ADR-010).
//
// Storage: the base URL in the `personalProxy` setting (plain), the token in the vault under
// `proxy:token` (ADR-006). Per list, `prefs.proxy` says what goes through it: absent/`off`
// (direct, the default for every list), `streams` (playback: streams and HLS playlists) or `all`
// (also the data requests: Xtream API, M3U download, short EPG). Images never do.
//
// Everything read back is untrusted (another app version, a corrupted row): an invalid value
// falls back to the identity rewriter (direct) with a warning, never to an error.
//
// Used on the main thread (players, VOD/series details, EPG) and in the data worker (syncs).
// `@/core/db`, `@/core/crypto` and `@/core/net` are imported dynamically: modules that reach this
// one from the initial bundle must not pull them in.
import type { ProxyRouting, Source } from '@/core/db';
import { log, registerSecret } from '@/core/log';
import type { RequestPurpose, UrlRewriter } from '@/core/net';

/** Vault ref of the proxy token. */
export const PROXY_TOKEN_REF = 'proxy:token';

export const PROXY_ROUTINGS: readonly ProxyRouting[] = ['off', 'streams', 'all'];

export interface PersonalProxyConfig {
  /** Normalized base URL. */
  baseUrl: string;
  token: string;
}

export interface SourceRewriters {
  /** For the player: streams and playlists (`streams` and `all`). */
  playback: UrlRewriter;
  /** For the data requests: API, playlist (M3U download) and EPG (`all` only). */
  data: UrlRewriter;
}

const identity: UrlRewriter = { rewrite: (url) => url };
const DIRECT: SourceRewriters = { playback: identity, data: identity };

const PLAYBACK_PURPOSES: readonly RequestPurpose[] = ['stream', 'playlist'];
const DATA_PURPOSES: readonly RequestPurpose[] = ['api', 'playlist', 'epg'];

/** A list's routing; anything but a known value (absent included) is `off`. */
export function proxyRoutingOf(source: Pick<Source, 'prefs'>): ProxyRouting {
  const value: unknown = (source.prefs as { proxy?: unknown } | undefined)?.proxy;
  if (value === undefined) return 'off';
  if (typeof value === 'string' && (PROXY_ROUTINGS as readonly string[]).includes(value)) {
    return value as ProxyRouting;
  }
  log.warn('proxy: unknown routing of a list, using direct');
  return 'off';
}

/**
 * A proxy is saved but its token cannot be read from the vault (locked, key lost…). Requests of a
 * list routed through the proxy fail instead of going direct (SEC-02): direct would send the
 * list's traffic, Xtream credentials included, to the provider the user chose to avoid.
 */
export class ProxyTokenUnavailableError extends Error {
  override readonly name = 'ProxyTokenUnavailableError';
  constructor(options?: { cause?: unknown }) {
    super('The personal proxy token cannot be read', options);
  }
}

export interface LoadPersonalProxyOptions {
  /** Throw `ProxyTokenUnavailableError` instead of `undefined` when the token cannot be read. */
  failOnUnreadableToken?: boolean;
}

/**
 * The saved proxy, or `undefined` when none is saved or what is stored is not valid (the token
 * missing or unreadable, a corrupt URL). The token is registered with the log redactor.
 */
export async function loadPersonalProxy(
  options: LoadPersonalProxyOptions = {},
): Promise<PersonalProxyConfig | undefined> {
  const [{ settingsRepo }, { credentialVault }, { parseProxyBaseUrl, isValidProxyToken }] =
    await Promise.all([import('@/core/db'), import('@/core/crypto'), import('@/core/net')]);
  const stored: unknown = await settingsRepo.get('personalProxy');
  if (stored === undefined) return undefined;
  const rawUrl =
    stored !== null && typeof stored === 'object' ? (stored as { baseUrl?: unknown }).baseUrl : '';
  const base = typeof rawUrl === 'string' ? parseProxyBaseUrl(rawUrl) : undefined;
  if (!base?.ok) {
    log.warn('proxy: the saved proxy address is not valid, using direct');
    return undefined;
  }
  let token: string | undefined;
  try {
    token = await credentialVault.get(PROXY_TOKEN_REF);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    if (options.failOnUnreadableToken) {
      log.warn('proxy: the proxy token could not be read', { error: name });
      throw new ProxyTokenUnavailableError({ cause: error });
    }
    log.warn('proxy: the proxy token could not be read, using direct', { error: name });
    return undefined;
  }
  if (token === undefined || !isValidProxyToken(token)) {
    log.warn('proxy: no valid proxy token saved, using direct');
    return undefined;
  }
  registerSecret(token);
  return { baseUrl: base.baseUrl, token };
}

/** Thrown by `savePersonalProxy` for an invalid address or token (nothing is saved). */
export class InvalidProxyConfigError extends Error {
  override readonly name = 'InvalidProxyConfigError';
  constructor(readonly field: 'baseUrl' | 'token') {
    super(`Invalid personal proxy ${field}`);
  }
}

/**
 * Saves the proxy: the token in the vault first, then the address (whose presence means "a proxy
 * is configured"). Lists keep their routing (new lists start `off`).
 */
export async function savePersonalProxy(config: PersonalProxyConfig): Promise<void> {
  const [{ settingsRepo }, { credentialVault }, { parseProxyBaseUrl, isValidProxyToken }] =
    await Promise.all([import('@/core/db'), import('@/core/crypto'), import('@/core/net')]);
  const base = parseProxyBaseUrl(config.baseUrl);
  if (!base.ok) throw new InvalidProxyConfigError('baseUrl');
  if (!isValidProxyToken(config.token)) throw new InvalidProxyConfigError('token');
  await credentialVault.put(PROXY_TOKEN_REF, config.token);
  await settingsRepo.set('personalProxy', { baseUrl: base.baseUrl });
}

/**
 * Removes the proxy (address and token) and turns routing off for every list, so saving a proxy
 * again later never switches a list on by itself.
 */
export async function removePersonalProxy(): Promise<void> {
  const [{ settingsRepo, sourcesRepo }, { credentialVault }] = await Promise.all([
    import('@/core/db'),
    import('@/core/crypto'),
  ]);
  await settingsRepo.remove('personalProxy');
  await credentialVault.delete(PROXY_TOKEN_REF);
  for (const source of await sourcesRepo.list()) {
    if ((source.prefs as { proxy?: unknown } | undefined)?.proxy === undefined) continue;
    const prefs = { ...source.prefs };
    delete prefs.proxy;
    await sourcesRepo.update(source.id, { prefs });
  }
}

export interface RewritersDeps {
  /** Default {@link loadPersonalProxy}. */
  loadProxy?: () => Promise<PersonalProxyConfig | undefined>;
}

/**
 * The rewriters for a list's requests. Direct (identity) when the list's routing is `off` (no
 * storage read then), and when no valid proxy is saved. A list routed through the proxy whose
 * settings or token cannot be read rejects (never direct): the request or sync fails.
 */
export async function rewritersForSource(
  source: Pick<Source, 'prefs'>,
  deps: RewritersDeps = {},
): Promise<SourceRewriters> {
  const routing = proxyRoutingOf(source);
  if (routing === 'off') return DIRECT;
  const config = await (
    deps.loadProxy ?? (() => loadPersonalProxy({ failOnUnreadableToken: true }))
  )();
  if (!config) {
    log.warn('proxy: a list is routed through the proxy but none is saved, using direct');
    return DIRECT;
  }
  const { createProxyRewriter } = await import('@/core/net');
  return {
    playback: createProxyRewriter({ ...config, purposes: PLAYBACK_PURPOSES }),
    data:
      routing === 'all' ? createProxyRewriter({ ...config, purposes: DATA_PURPOSES }) : identity,
  };
}
