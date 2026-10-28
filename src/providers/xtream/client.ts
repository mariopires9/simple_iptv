// Xtream Codes API client (SRC-02, RESEARCH.md §7). All calls go to `{baseUrl}/player_api.php`.
import { registerSecret } from '@/core/log';
import {
  DEFAULT_TIMEOUT_MS,
  NetError,
  fetchJson,
  type FetchImpl,
  type UrlRewriter,
} from '@/core/net';
import { assertServerUrl } from './normalizeServerUrl';
import { parseAuthResponse, type XtreamAuthInfo } from './schemas';

export interface XtreamClientOptions {
  /** Server address as typed by the user; normalized with `normalizeServerUrl`. */
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: FetchImpl;
  rewriter?: UrlRewriter;
  /** Per-request timeout in ms. Default 15 s. */
  timeoutMs?: number;
}

export type XtreamParams = Record<string, string | number | undefined>;

export interface XtreamClient {
  /** Normalized `scheme://host[:port]`. Contains no credentials. */
  readonly baseUrl: string;
  /**
   * `player_api.php` without `action`. Throws `NetError(kind='auth')` when `user_info.auth` is
   * not 1 (or on 401/403) and `NetError(kind='parse')` when the body is not an auth response.
   * A non-active account (Expired, Banned…) is returned, not thrown: see `testConnection`.
   */
  authenticate(signal?: AbortSignal): Promise<XtreamAuthInfo>;
  /**
   * Raw `player_api.php?action=…` call for later stories; the result is unvalidated JSON.
   * Panels answer every action with the auth JSON when the account is not usable; when that JSON
   * rejects the credentials (`user_info.auth` 0) it is reported as `NetError(kind='auth')`.
   */
  call(action: string, params?: XtreamParams, signal?: AbortSignal): Promise<unknown>;
}

/** `{ user_info: { auth: 0 | "0" | false } }` as returned by panels for rejected credentials. */
function isAuthRejection(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const userInfo = (body as { user_info?: unknown }).user_info;
  if (userInfo === null || typeof userInfo !== 'object') return false;
  const info = parseAuthResponse(body);
  return info !== undefined && !info.account.auth;
}

export function createXtreamClient(options: XtreamClientOptions): XtreamClient {
  const { username, password, fetchImpl, rewriter, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  // Register first: even an invalid-URL error path must never leak them.
  registerSecret(username);
  registerSecret(password);
  const baseUrl = assertServerUrl(options.baseUrl);

  function buildUrl(action?: string, params: XtreamParams = {}): string {
    const url = new URL('/player_api.php', baseUrl);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    if (action !== undefined) url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.href;
  }

  function get(url: string, signal?: AbortSignal): Promise<unknown> {
    const opts: Parameters<typeof fetchJson>[1] = { timeoutMs, purpose: 'api' };
    if (signal !== undefined) opts.signal = signal;
    if (fetchImpl !== undefined) opts.fetchImpl = fetchImpl;
    if (rewriter !== undefined) opts.rewriter = rewriter;
    return fetchJson(url, opts);
  }

  return {
    baseUrl,

    async authenticate(signal) {
      const url = buildUrl();
      const body = await get(url, signal);
      const info = parseAuthResponse(body);
      if (info === undefined) {
        throw new NetError({ kind: 'parse', url, cause: 'Not an Xtream auth response' });
      }
      if (!info.account.auth) throw new NetError({ kind: 'auth', url });
      return info;
    },

    async call(action, params, signal) {
      const url = buildUrl(action, params);
      const body = await get(url, signal);
      if (isAuthRejection(body)) throw new NetError({ kind: 'auth', url });
      return body;
    },
  };
}
