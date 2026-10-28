// Connection test for an Xtream source (SRC-02 AC2–AC7): authenticates, reads the account state
// and, for an http server that reports `https_port`, tries HTTPS automatically.
import { log } from '@/core/log';
import { isNetError, type NetError } from '@/core/net';
import { createXtreamClient, type XtreamClientOptions } from './client';
import type { XtreamAccount } from './schemas';
import type {
  ConnectionAccount,
  ConnectionFixCode,
  ConnectionProblem,
  ConnectionProblemCode,
  XtreamConnectionReport,
} from './types';

export interface TestConnectionOptions extends XtreamClientOptions {
  signal?: AbortSignal;
  /** Clock for the expiry check. Default `Date.now`. */
  now?: () => number;
}

const PROBLEMS: Record<
  ConnectionProblemCode,
  { severity: 'error' | 'warning'; message: string; fix?: ConnectionFixCode }
> = {
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
    fix: 'see-connection-options',
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
  const { severity, message, fix } = PROBLEMS[code];
  return fix !== undefined ? { code, severity, message, fix } : { code, severity, message };
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

function finish(report: XtreamConnectionReport): XtreamConnectionReport {
  log.info('Xtream connection test finished', {
    ok: report.ok,
    https: report.https,
    corsApi: report.corsApi,
    problems: report.problems.map((p) => p.code),
    httpsCheck: report.httpsCheck
      ? { ok: report.httpsCheck.ok, error: report.httpsCheck.error }
      : undefined,
  });
  return report;
}

/**
 * Tests the connection. Network/auth failures are returned in the report (`ok: false`, `error`,
 * a problem code); only caller cancellation (`NetError(kind='aborted')`) and an invalid server
 * URL (`InvalidServerUrlError`) are thrown.
 */
export async function testConnection(
  options: TestConnectionOptions,
): Promise<XtreamConnectionReport> {
  const { signal, now = Date.now, ...clientOptions } = options;
  const client = createXtreamClient(clientOptions);
  const isHttps = client.baseUrl.startsWith('https:');

  let info;
  try {
    info = await client.authenticate(signal);
  } catch (error) {
    if (!isNetError(error) || error.kind === 'aborted') throw error;
    return finish({
      ok: false,
      https: isHttps,
      corsApi: error.kind === 'blocked' ? 'blocked' : 'unknown',
      baseUrl: client.baseUrl,
      problems: [problem(errorProblem(error))],
      error,
    });
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

  const report: XtreamConnectionReport = {
    ok: true,
    https: isHttps,
    corsApi: 'ok',
    baseUrl: client.baseUrl,
    account: toReportAccount(info.account),
    problems,
  };

  const httpsPort = info.server?.httpsPort;
  if (!isHttps && httpsPort !== undefined) {
    const httpsClient = createXtreamClient({
      ...clientOptions,
      baseUrl: httpsBaseUrl(client.baseUrl, httpsPort),
    });
    try {
      await httpsClient.authenticate(signal);
      report.https = true;
      report.baseUrl = httpsClient.baseUrl;
      report.httpsCheck = { baseUrl: httpsClient.baseUrl, ok: true };
    } catch (error) {
      if (!isNetError(error) || error.kind === 'aborted') throw error;
      report.httpsCheck = { baseUrl: httpsClient.baseUrl, ok: false, error: error.kind };
      problems.push(problem('https-unavailable'));
    }
  }
  if (!report.https) problems.push(problem('http-only'));

  report.ok = !problems.some((p) => p.severity === 'error');
  return finish(report);
}
