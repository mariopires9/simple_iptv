// Runs the compatibility diagnostics of one list (SRC-09). At most ONE lightweight request goes
// to the provider, through the existing clients (core/net, providers/xtream): the Xtream login
// (`testConnection`, which also tries HTTPS on the same host) or the first bytes of an M3U list.
// A local file and an offline device make no request. Secrets (password, list URL) are read from
// the vault into memory for that request only and never enter the result.
import { credentialVault } from '@/core/crypto';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { fetchStream, isNetError, isNetworkBlocked, shortenUrl } from '@/core/net';
import { getCapabilities, type Capabilities } from '@/core/platform';
import { testConnection, type XtreamConnectionReport } from '@/providers/xtream';
import { readXtreamPassword } from '../manage';
import {
  checkApi,
  checkBrowser,
  checkCodecs,
  checkHttps,
  checkLiveFormat,
  protocolOf,
  type ApiProbe,
  type CheckResult,
} from './checks';
import { probeCodecs, type CodecSupport } from './codecs';

/** Timeout of the single provider request. */
export const DIAGNOSTICS_TIMEOUT_MS = 10_000;

export interface DiagnosticsResult {
  sourceKind: Source['kind'];
  /**
   * Address of the list as it may be shown or copied: `shortenUrl` (scheme, host masked, path
   * segments masked, no query). Undefined for a local file or when it could not be read.
   */
  maskedAddress?: string;
  checks: CheckResult[];
  /** When the checks ran (epoch ms). */
  at: number;
}

export interface DiagnosticsDeps {
  /** Xtream password from the vault. */
  readPassword: (sourceId: string) => Promise<string | undefined>;
  /** M3U list URL from the vault. */
  readListUrl: (source: Source) => Promise<string | undefined>;
  testXtream: (options: Parameters<typeof testConnection>[0]) => Promise<XtreamConnectionReport>;
  /** Fetches the first bytes of a list (CORS / reachability). */
  probeList: (url: string, signal: AbortSignal | undefined) => Promise<void>;
  capabilities: () => Capabilities;
  codecs: () => CodecSupport[];
  pageProtocol: () => string | undefined;
  offline: () => boolean;
  now: () => number;
}

const defaultProbeList: DiagnosticsDeps['probeList'] = async (url, signal) => {
  await fetchStream(
    url,
    async (body) => {
      // One chunk proves the browser let the response through; the rest is cancelled.
      await body.read();
    },
    {
      purpose: 'playlist',
      inactivityTimeoutMs: DIAGNOSTICS_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    },
  );
};

export const defaultDiagnosticsDeps: DiagnosticsDeps = {
  readPassword: readXtreamPassword,
  readListUrl: (source) =>
    source.secretRef !== undefined
      ? credentialVault.get(source.secretRef)
      : Promise.resolve(undefined),
  testXtream: testConnection,
  probeList: defaultProbeList,
  capabilities: () => getCapabilities(),
  codecs: () => probeCodecs(),
  pageProtocol: () => (globalThis as { location?: { protocol?: string } }).location?.protocol,
  offline: () => isNetworkBlocked(),
  now: () => Date.now(),
};

/** Secret reads may fail (key lost, storage blocked): the API check then says so. */
async function safeRead(read: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await read();
  } catch (error) {
    log.warn('Diagnostics: the stored secret could not be read', { error });
    return undefined;
  }
}

function errorProbe(error: unknown, signal: AbortSignal | undefined): ApiProbe {
  if (!isNetError(error)) throw error;
  // The caller cancelled (screen left): not a result.
  if (error.kind === 'aborted' && signal?.aborted === true) throw error;
  return { outcome: 'error', error };
}

interface ApiOutcome {
  probe: ApiProbe;
  /** The server answered over HTTPS too (Xtream automatic attempt). */
  httpsAvailable?: boolean;
  /** Xtream `allowed_output_formats`. */
  allowed?: string[];
}

async function probeXtream(
  source: Source,
  deps: DiagnosticsDeps,
  signal: AbortSignal | undefined,
): Promise<ApiOutcome> {
  const password = await safeRead(() => deps.readPassword(source.id));
  if (password === undefined || !source.serverUrl || !source.username) {
    return { probe: { outcome: 'no-secret' } };
  }
  let report: XtreamConnectionReport;
  try {
    report = await deps.testXtream({
      baseUrl: source.serverUrl,
      username: source.username,
      password,
      timeoutMs: DIAGNOSTICS_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    // `testConnection` returns network failures in the report; it throws on an invalid address.
    if (isNetError(error)) return { probe: errorProbe(error, signal) };
    log.warn('Diagnostics: the connection test failed', { error });
    return { probe: { outcome: 'no-secret' } };
  }
  const out: ApiOutcome = {
    probe: report.error ? { outcome: 'error', error: report.error } : { outcome: 'ok' },
  };
  if (report.httpsCheck?.ok === true) out.httpsAvailable = true;
  if (report.account) out.allowed = report.account.formats;
  return out;
}

async function probeM3u(
  source: Source,
  deps: DiagnosticsDeps,
  signal: AbortSignal | undefined,
): Promise<{ outcome: ApiOutcome; protocol?: string; maskedAddress?: string }> {
  const url = await safeRead(() => deps.readListUrl(source));
  if (url === undefined) return { outcome: { probe: { outcome: 'no-secret' } } };
  const address = { protocol: protocolOf(url), maskedAddress: shortenUrl(url) };
  try {
    await deps.probeList(url, signal);
    return { outcome: { probe: { outcome: 'ok' } }, ...address };
  } catch (error) {
    return { outcome: { probe: errorProbe(error, signal) }, ...address };
  }
}

/**
 * Runs every check for `source`. Rejects only when `signal` is aborted (or on a programming
 * error); every network failure is a check result.
 */
export async function runDiagnostics(
  source: Source,
  options: { signal?: AbortSignal; deps?: Partial<DiagnosticsDeps> } = {},
): Promise<DiagnosticsResult> {
  const deps = { ...defaultDiagnosticsDeps, ...options.deps };
  const { signal } = options;
  const caps = deps.capabilities();
  const offline = deps.offline();

  let api: ApiOutcome;
  let sourceProtocol: string | undefined;
  let maskedAddress: string | undefined;
  if (source.kind === 'm3u-file') {
    api = { probe: { outcome: 'not-applicable' } };
  } else if (source.kind === 'xtream') {
    sourceProtocol = protocolOf(source.serverUrl);
    maskedAddress = source.serverUrl !== undefined ? shortenUrl(source.serverUrl) : undefined;
    api = offline ? { probe: { outcome: 'offline' } } : await probeXtream(source, deps, signal);
  } else if (offline) {
    // The protocol is still worth reporting: read the address without contacting it.
    const url = await safeRead(() => deps.readListUrl(source));
    sourceProtocol = protocolOf(url);
    maskedAddress = url !== undefined ? shortenUrl(url) : undefined;
    api = { probe: { outcome: 'offline' } };
  } else {
    const m3u = await probeM3u(source, deps, signal);
    api = m3u.outcome;
    sourceProtocol = m3u.protocol;
    maskedAddress = m3u.maskedAddress;
  }

  const checks: CheckResult[] = [
    checkHttps({
      kind: source.kind,
      sourceProtocol,
      pageProtocol: deps.pageProtocol(),
      ...(api.httpsAvailable ? { httpsAvailable: true } : {}),
    }),
    checkApi(api.probe, source.kind),
    checkLiveFormat({
      kind: source.kind,
      configured: source.prefs.liveFormat,
      ...(api.allowed ? { allowed: api.allowed } : {}),
      caps,
    }),
    checkBrowser(caps),
    checkCodecs(deps.codecs(), caps),
  ];
  log.info('Diagnostics finished', {
    sourceId: source.id,
    kind: source.kind,
    checks: checks.map((c) => `${c.id}:${c.status}:${c.reason}`),
  });
  const result: DiagnosticsResult = { sourceKind: source.kind, checks, at: deps.now() };
  if (maskedAddress !== undefined) result.maskedAddress = maskedAddress;
  return result;
}
