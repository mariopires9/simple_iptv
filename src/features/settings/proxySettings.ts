// Settings › Personal proxy (PRX-01, ADR-010): the proxy's address and token, its connection test
// and each list's routing. Storage and the rewriters live in core/session (`savePersonalProxy`,
// `rewritersForSource`); this module only adapts them to the section.
//
// The connection test talks to the proxy directly (identity rewriter): `GET B/v1/<token>/health`,
// with the active list's server origin as the probe so the proxy also says whether its allowlist
// lets that server through. Only the origin is sent (an M3U address may carry credentials in its
// path or query).
import { credentialVault } from '@/core/crypto';
import { sourcesRepo, type ProxyRouting, type Source } from '@/core/db';
import { log } from '@/core/log';
import {
  fetchJson,
  identityRewriter,
  isNetError,
  isValidProxyToken,
  parseProxyBaseUrl,
  parseProxyHealth,
  proxyHealthUrl,
  type ProxyBaseUrlRejection,
} from '@/core/net';
import {
  loadActiveSource,
  loadPersonalProxy,
  PROXY_ROUTINGS,
  proxyRoutingOf,
  removePersonalProxy,
  savePersonalProxy,
  type PersonalProxyConfig,
} from '@/core/session';

export { PROXY_ROUTINGS };

/** Timeout of the connection test (a sleeping PC or Tailscale off would otherwise take 15 s). */
export const PROXY_TEST_TIMEOUT_MS = 8_000;

export interface ProxyListRouting {
  id: string;
  name: string;
  routing: ProxyRouting;
}

export interface ProxySettings {
  /** The saved proxy's address; `undefined` when none (or none valid) is saved. */
  savedBaseUrl: string | undefined;
  lists: ProxyListRouting[];
}

export async function loadProxySettings(): Promise<ProxySettings> {
  const [config, sources] = await Promise.all([loadPersonalProxy(), sourcesRepo.list()]);
  return {
    savedBaseUrl: config?.baseUrl,
    lists: sources.map((s) => ({ id: s.id, name: s.name, routing: proxyRoutingOf(s) })),
  };
}

export type TokenProblem = 'required' | 'invalid';

export interface ProxyFormProblems {
  baseUrl?: ProxyBaseUrlRejection;
  token?: TokenProblem;
}

export type ProxyFormResult =
  { ok: true; config: PersonalProxyConfig } | { ok: false; problems: ProxyFormProblems };

/**
 * Validates the form. An empty token keeps the saved one (when a proxy is saved): the token is
 * never shown back in the form.
 */
export async function resolveProxyForm(
  baseUrlInput: string,
  tokenInput: string,
): Promise<ProxyFormResult> {
  const problems: ProxyFormProblems = {};
  const base = parseProxyBaseUrl(baseUrlInput);
  if (!base.ok) problems.baseUrl = base.reason;
  let token = tokenInput.trim();
  if (token === '') {
    token = (await loadPersonalProxy())?.token ?? '';
    if (token === '') problems.token = 'required';
  } else if (!isValidProxyToken(token)) {
    problems.token = 'invalid';
  }
  if (!base.ok || problems.token !== undefined) return { ok: false, problems };
  return { ok: true, config: { baseUrl: base.baseUrl, token } };
}

export function saveProxy(config: PersonalProxyConfig): Promise<void> {
  return savePersonalProxy(config);
}

export function removeProxy(): Promise<void> {
  return removePersonalProxy();
}

/** Sets a list's routing (its other preferences kept). Rejects if the list is gone. */
export async function saveListRouting(sourceId: string, routing: ProxyRouting): Promise<void> {
  const source = await sourcesRepo.get(sourceId);
  if (!source) throw new Error('The list no longer exists');
  const prefs = { ...source.prefs };
  delete prefs.proxy;
  await sourcesRepo.update(sourceId, {
    prefs: routing === 'off' ? prefs : { ...prefs, proxy: routing },
  });
}

export type ProxyTestOutcome =
  | { kind: 'ok'; activeUpstreams: number; listName?: string }
  | { kind: 'not-allowed'; listName: string }
  | { kind: 'auth' }
  | { kind: 'unreachable' }
  | { kind: 'not-proxy' };

interface Probe {
  name: string;
  url: string;
}

/** Origin of the active list's server, if it has one (an M3U file has none). */
async function activeListProbe(): Promise<Probe | undefined> {
  try {
    const id = await loadActiveSource();
    const source: Source | undefined = id === undefined ? undefined : await sourcesRepo.get(id);
    if (!source) return undefined;
    let raw: string | undefined;
    if (source.kind === 'xtream') raw = source.serverUrl;
    else if (source.kind === 'm3u-url' && source.secretRef) {
      raw = await credentialVault.get(source.secretRef);
    }
    if (raw === undefined) return undefined;
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return { name: source.name, url: `${url.origin}/` };
  } catch (error) {
    log.warn('settings: the active list could not be read for the proxy test', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return undefined;
  }
}

/** Tests the proxy (and, when the active list has a server, whether it allows that server). */
export async function testProxy(
  config: PersonalProxyConfig,
  options: { signal?: AbortSignal } = {},
): Promise<ProxyTestOutcome> {
  const probe = await activeListProbe();
  let body: unknown;
  try {
    body = await fetchJson(proxyHealthUrl(config.baseUrl, config.token, probe?.url), {
      rewriter: identityRewriter,
      timeoutMs: PROXY_TEST_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (!isNetError(error)) throw error;
    switch (error.kind) {
      case 'auth':
        return { kind: 'auth' };
      case 'parse':
        return { kind: 'not-proxy' };
      case 'http':
        // A gateway in front of a stopped proxy (Tailscale Serve answers 502) is "unreachable".
        return error.status !== undefined && error.status >= 500
          ? { kind: 'unreachable' }
          : { kind: 'not-proxy' };
      case 'aborted':
        throw error;
      default:
        return { kind: 'unreachable' };
    }
  }
  const health = parseProxyHealth(body);
  if (!health) return { kind: 'not-proxy' };
  if (probe && health.upstreamAllowed === false)
    return { kind: 'not-allowed', listName: probe.name };
  return {
    kind: 'ok',
    activeUpstreams: health.activeUpstreams,
    ...(probe && health.upstreamAllowed === true ? { listName: probe.name } : {}),
  };
}
