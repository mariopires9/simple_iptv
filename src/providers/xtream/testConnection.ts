// Connection test for an Xtream source (SRC-02 AC2–AC7): authenticates, reads the account state
// and tries HTTPS automatically on the host the user entered (mixed-content block, `https_port`).
import { log } from '@/core/log';
import { isNetError, type NetError } from '@/core/net';
import { createXtreamClient, type XtreamClientOptions } from './client';
import type { XtreamAccount, XtreamAuthInfo } from './schemas';
import type {
  ConnectionAccount,
  ConnectionFixCode,
  ConnectionProblem,
  ConnectionProblemCode,
  HttpsAttempt,
  XtreamConnectionReport,
} from './types';

/** Timeout for each automatic HTTPS probe. */
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export interface TestConnectionOptions extends XtreamClientOptions {
  signal?: AbortSignal;
  /** Timeout for each automatic HTTPS probe. Default {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  probeTimeoutMs?: number;
  /** Clock for the expiry check. Default `Date.now`. */
  now?: () => number;
}

type HttpsCheck = HttpsAttempt;

interface ProblemSpec {
  severity: 'error' | 'warning';
  message: string;
  fix?: ConnectionFixCode;
  fixes?: ConnectionFixCode[];
}

const PROBLEMS: Record<ConnectionProblemCode, ProblemSpec> = {
  'auth-failed': {
    severity: 'error',
    message: 'The server rejected the username or password',
    fix: 'check-credentials',
  },
  'account-expired': {
    severity: 'error',
    message: 'The account has expired',
    fix: 'renew-subscription',
  },
  'account-banned': {
    severity: 'error',
    message: 'The account is banned',
    fix: 'contact-provider',
  },
  'account-disabled': {
    severity: 'error',
    message: 'The account is disabled',
    fix: 'contact-provider',
  },
  'account-inactive': {
    severity: 'error',
    message: 'The account is not active',
    fix: 'contact-provider',
  },
  'max-connections-reached': {
    severity: 'warning',
    message: 'All allowed connections are in use',
    fix: 'close-other-players',
  },
  offline: { severity: 'error', message: 'The device is offline', fix: 'check-network' },
  timeout: { severity: 'error', message: 'The server did not answer in time', fix: 'retry-later' },
  'blocked-mixed-content': {
    severity: 'error',
    message: 'The browser blocked an http request from an https page (mixed content)',
    fix: 'use-https',
    fixes: ['use-https', 'use-local-file', 'use-proxy'],
  },
  'blocked-cors': {
    severity: 'error',
    message: 'The browser blocked the request (CORS, DNS or connection failure)',
    fix: 'see-connection-options',
  },
  'network-error': {
    severity: 'error',
    message: 'The request did not complete',
    fix: 'check-server-url',
  },
  'http-error': {
    severity: 'error',
    message: 'The server answered with an unexpected HTTP status',
    fix: 'retry-later',
  },
  'invalid-response': {
    severity: 'error',
    message: 'The server did not return a valid Xtream response',
    fix: 'check-server-url',
  },
  'http-only': {
    severity: 'warning',
    message: 'The server is only reachable over http',
    fix: 'see-connection-options',
  },
  'https-unavailable': {
    severity: 'warning',
    message: 'The server reports an https port but https did not work',
  },
};

function problem(code: ConnectionProblemCode): ConnectionProblem {
  const { severity, message, fix, fixes } = PROBLEMS[code];
  const out: ConnectionProblem = { code, severity, message };
  if (fix !== undefined) out.fix = fix;
  if (fixes !== undefined) out.fixes = [...fixes];
  return out;
}

function errorProblem(error: NetError): ConnectionProblemCode {
  switch (error.kind) {
    case 'auth':
      return 'auth-failed';
    case 'offline':
      return 'offline';
    case 'timeout':
      return 'timeout';
    case 'blocked':
      if (error.hint === 'mixed-content') return 'blocked-mixed-content';
      if (error.hint === 'cors') return 'blocked-cors';
      return 'network-error';
    case 'http':
      return 'http-error';
    case 'parse':
      return 'invalid-response';
    case 'aborted':
      return 'network-error';
  }
}

/** Problem for a non-active account, or undefined. A missing status is tolerated. */
function statusProblem(account: XtreamAccount, now: number): ConnectionProblemCode | undefined {
  const status = account.status?.toLowerCase();
  if (status === undefined || status === 'active') {
    return account.expiresAt !== undefined && account.expiresAt <= now
      ? 'account-expired'
      : undefined;
  }
  if (status === 'expired') return 'account-expired';
  if (status === 'banned') return 'account-banned';
  if (status === 'disabled') return 'account-disabled';
  return 'account-inactive';
}

function toReportAccount(account: XtreamAccount): ConnectionAccount {
  const out: ConnectionAccount = { status: account.status ?? 'Unknown', formats: account.formats };
  if (account.expiresAt !== undefined) out.expiresAt = account.expiresAt;
  if (account.maxConnections !== undefined) out.maxConnections = account.maxConnections;
  if (account.activeConnections !== undefined) out.activeConnections = account.activeConnections;
  return out;
}

/** HTTPS base on the same host the user entered (never `server_info.url`, which may differ). */
function httpsBaseUrl(baseUrl: string, port: number): string {
  const url = new URL(baseUrl);
  url.protocol = 'https:';
  url.port = String(port);
  return url.origin;
}

/**
 * HTTPS candidates for an http panel blocked as mixed content, on the host the user entered:
 * the same port first (when one was given), then the default 443.
 */
function mixedContentCandidates(baseUrl: string): string[] {
  const { port } = new URL(baseUrl);
  const candidates = port !== '' ? [httpsBaseUrl(baseUrl, Number(port))] : [];
  candidates.push(httpsBaseUrl(baseUrl, 443));
  return [...new Set(candidates)];
}

/** Rethrows caller cancellation (and non-NetErrors); returns the NetError otherwise. */
function reportable(error: unknown, signal: AbortSignal | undefined): NetError {
  if (!isNetError(error)) throw error;
  if (error.kind === 'aborted' && signal?.aborted === true) throw error;
  return error;
}

function failure(
  error: NetError,
  baseUrl: string,
  extra: Pick<XtreamConnectionReport, 'httpsCheck' | 'httpsAttempts'> = {},
): XtreamConnectionReport {
  const report: XtreamConnectionReport = {
    ok: false,
    https: baseUrl.startsWith('https:'),
    corsApi: error.kind === 'blocked' ? 'blocked' : 'unknown',
    baseUrl,
    problems: [problem(errorProblem(error))],
    error,
  };
  if (extra.httpsCheck !== undefined) report.httpsCheck = extra.httpsCheck;
  if (extra.httpsAttempts !== undefined) report.httpsAttempts = extra.httpsAttempts;
  return report;
}

function finish(report: XtreamConnectionReport): XtreamConnectionReport {
  log.info('Xtream connection test finished', {
    ok: report.ok,
    https: report.https,
    corsApi: report.corsApi,
    problems: report.problems.map((p) => p.code),
    httpsAttempts: report.httpsAttempts?.map((a) => ({ ok: a.ok, error: a.error })),
  });
  return report;
}

/**
 * Tests the connection. Network/auth failures are returned in the report (`ok: false`, `error`,
 * a problem code); only caller cancellation (`NetError(kind='aborted')` with the caller's signal
 * aborted) and an invalid server URL (`InvalidServerUrlError`) are thrown.
 *
 * HTTPS is probed automatically, always on the host the user entered (credentials never go to
 * another host), each probe limited by `probeTimeoutMs`:
 * - http blocked as mixed content → `https://host:<same port>`, then `https://host`; the first
 *   that authenticates wins;
 * - http works, `server_info.https_port` is set and the account is usable →
 *   `https://host:<https_port>`.
 */
export async function testConnection(
  options: TestConnectionOptions,
): Promise<XtreamConnectionReport> {
  const {
    signal,
    now = Date.now,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    ...clientOptions
  } = options;
  const client = createXtreamClient(clientOptions);
  const probeClient = (baseUrl: string) =>
    createXtreamClient({ ...clientOptions, baseUrl, timeoutMs: probeTimeoutMs });

  let info: XtreamAuthInfo | undefined;
  let usableBase = client.baseUrl;
  let httpsCheck: HttpsCheck | undefined;
  const httpsAttempts: HttpsCheck[] = [];

  try {
    info = await client.authenticate(signal);
  } catch (thrown) {
    const error = reportable(thrown, signal);
    if (error.kind !== 'blocked' || error.hint !== 'mixed-content') {
      return finish(failure(error, client.baseUrl));
    }
    // This page can never reach the http panel: try HTTPS on the same host.
    for (const candidate of mixedContentCandidates(client.baseUrl)) {
      const httpsClient = probeClient(candidate);
      try {
        info = await httpsClient.authenticate(signal);
        httpsCheck = { baseUrl: httpsClient.baseUrl, ok: true };
        httpsAttempts.push(httpsCheck);
        usableBase = httpsClient.baseUrl;
        break;
      } catch (probeThrown) {
        const probeError = reportable(probeThrown, signal);
        httpsCheck = { baseUrl: httpsClient.baseUrl, ok: false, error: probeError.kind };
        httpsAttempts.push(httpsCheck);
        // HTTPS reached the panel and it rejected the credentials: that is the real answer.
        if (probeError.kind === 'auth') {
          return finish(failure(probeError, httpsClient.baseUrl, { httpsCheck, httpsAttempts }));
        }
      }
    }
    if (info === undefined) {
      return finish(failure(error, client.baseUrl, { httpsCheck, httpsAttempts }));
    }
  }

  const problems: ConnectionProblem[] = [];
  const status = statusProblem(info.account, now());
  if (status !== undefined) problems.push(problem(status));
  const { maxConnections: max, activeConnections: active } = info.account;
  if (
    status === undefined &&
    max !== undefined &&
    max > 0 &&
    active !== undefined &&
    active >= max
  ) {
    problems.push(problem('max-connections-reached'));
  }

  // https_port probe: only on an http base with a usable account (a fatal problem makes it moot).
  const httpsPort = info.server?.httpsPort;
  if (usableBase.startsWith('http:') && httpsPort !== undefined && status === undefined) {
    const httpsClient = probeClient(httpsBaseUrl(usableBase, httpsPort));
    try {
      await httpsClient.authenticate(signal);
      httpsCheck = { baseUrl: httpsClient.baseUrl, ok: true };
      usableBase = httpsClient.baseUrl;
    } catch (thrown) {
      const error = reportable(thrown, signal);
      httpsCheck = { baseUrl: httpsClient.baseUrl, ok: false, error: error.kind };
      problems.push(problem('https-unavailable'));
    }
    httpsAttempts.push(httpsCheck);
  }

  const https = usableBase.startsWith('https:');
  if (!https) problems.push(problem('http-only'));
  const report: XtreamConnectionReport = {
    ok: !problems.some((p) => p.severity === 'error'),
    https,
    corsApi: 'ok',
    baseUrl: usableBase,
    account: toReportAccount(info.account),
    problems,
  };
  if (httpsCheck !== undefined) report.httpsCheck = httpsCheck;
  if (httpsAttempts.length > 0) report.httpsAttempts = httpsAttempts;
  return finish(report);
}
