// Compatibility checks of one list (SRC-09 AC1/AC2). Pure functions: each takes what was observed
// (page and list protocols, the outcome of one API request, the browser's capabilities) and returns
// a stable result — status, a reason code and suggested actions — that the screen and the copied
// report translate (ADR-015). Nothing here bypasses CORS, mixed content or DRM: the checks only
// explain what the browser allows.
import type { LiveFormat, SourceKind } from '@/core/db';
import type { NetError } from '@/core/net';
import type { Capabilities } from '@/core/platform';
import { selectEngine, type EngineChoice } from '@/player';
import {
  MIXED_CONTENT_FINDINGS,
  probeImpact,
  summarizeFindings,
  type ProbeFinding,
  type StreamProbeResult,
} from '@/player/probe';
import { REQUIRED_CODECS, type CodecId, type CodecSupport } from './codecs';

export type CheckId = 'https' | 'api' | 'liveFormat' | 'liveStream' | 'browser' | 'codecs';
export const CHECK_IDS: readonly CheckId[] = [
  'https',
  'api',
  'liveFormat',
  'liveStream',
  'browser',
  'codecs',
];

/** `skipped`: not applicable (local file) or not possible right now (offline). */
export type CheckStatus = 'ok' | 'warning' | 'error' | 'skipped';

/**
 * Suggested actions. `proxy-future` only says a personal proxy option may come later (ADR-010 is
 * pending): it is never presented as available.
 */
export type DiagnosticAction =
  | 'use-https'
  | 'local-file'
  | 'safari'
  | 'proxy-future'
  | 'check-network'
  | 'check-credentials'
  | 'contact-provider'
  | 'switch-live-format'
  | 'device-app'
  | 'retry';

export type HttpsReason = 'https' | 'http-blocked' | 'http-local' | 'not-applicable';
export type ApiReason =
  | 'ok'
  | 'auth-rejected'
  | 'mixed-content'
  | 'cors'
  | 'timeout'
  | 'network-error'
  | 'http-error'
  | 'invalid-response'
  | 'offline'
  | 'no-secret'
  | 'invalid-address'
  | 'not-applicable';
export type LiveFormatReason =
  | 'ok'
  | 'format-not-allowed'
  | 'format-unplayable'
  | 'none-playable'
  | 'per-channel'
  | 'per-channel-partial';
/**
 * Live stream test (PLY-06): the most telling finding of the probed formats, or why nothing was
 * probed. `partial`: one format works, another does not.
 */
export type LiveStreamReason =
  ProbeFinding | 'partial' | 'no-channels' | 'offline' | 'no-secret' | 'unavailable';
export type BrowserReason = 'mse' | 'mms' | 'native-hls-only' | 'none';
export type CodecsReason = 'all' | 'optional-missing' | 'required-missing';

interface CheckBase<I extends CheckId, R extends string> {
  id: I;
  status: CheckStatus;
  reason: R;
  actions: DiagnosticAction[];
}

export type HttpsCheck = CheckBase<'https', HttpsReason> & {
  /** The server also answered over HTTPS (Xtream automatic HTTPS attempt). */
  httpsAvailable?: boolean;
};
export type ApiCheck = CheckBase<'api', ApiReason> & { httpStatus?: number };
/** Live formats this browser can play, with the engine that would be used. */
export interface LiveFormatSupport {
  ts: EngineChoice;
  hls: EngineChoice;
}
export type LiveFormatCheck = CheckBase<'liveFormat', LiveFormatReason> & {
  /** Xtream: the list's preference. */
  configured?: LiveFormat;
  /** Xtream: `allowed_output_formats` of the account, when the API answered. */
  allowed?: string[];
  /** Xtream, with `switch-live-format`: the preference that would work for this list. */
  suggested?: LiveFormat;
  support: LiveFormatSupport;
};
/** One probed live format (masked address only). */
export interface LiveStreamProbe {
  format: 'ts' | 'm3u8';
  /** Engine that would play it here. */
  engine: EngineChoice;
  result: StreamProbeResult;
  finding: ProbeFinding;
}
export type LiveStreamCheck = CheckBase<'liveStream', LiveStreamReason> & {
  probes: LiveStreamProbe[];
  /** Some probed format declares HEVC. */
  hevc: boolean;
  /** Xtream, with `switch-live-format`: the format that worked. */
  suggested?: LiveFormat;
};
export type BrowserCheck = CheckBase<'browser', BrowserReason> & {
  mse: boolean;
  mms: boolean;
  nativeHls: boolean;
};
export type CodecsCheck = CheckBase<'codecs', CodecsReason> & {
  codecs: CodecSupport[];
  missing: CodecId[];
};

export type CheckResult =
  HttpsCheck | ApiCheck | LiveFormatCheck | LiveStreamCheck | BrowserCheck | CodecsCheck;

export type PlaybackCaps = Pick<Capabilities, 'mse' | 'mms' | 'nativeHls' | 'isSafari'>;

/** Safari is only suggested to users who are not already on it. */
const safariIf = (caps: PlaybackCaps): DiagnosticAction[] => (caps.isSafari ? [] : ['safari']);

/** Protocol (`http:` / `https:`) of a URL, `undefined` when it does not parse. */
export function protocolOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).protocol;
  } catch {
    return undefined;
  }
}

/**
 * HTTPS (RESEARCH.md §6.1). An `http:` list on an `https:` page is blocked (mixed content); on an
 * `http:` page (local development) it works here but would be blocked in the published app.
 */
export function checkHttps(input: {
  kind: SourceKind;
  /** Protocol of the list's address (server or list URL). */
  sourceProtocol: string | undefined;
  pageProtocol: string | undefined;
  httpsAvailable?: boolean;
}): HttpsCheck {
  if (input.kind === 'm3u-file' || input.sourceProtocol === undefined) {
    return { id: 'https', status: 'skipped', reason: 'not-applicable', actions: [] };
  }
  if (input.sourceProtocol === 'https:') {
    return { id: 'https', status: 'ok', reason: 'https', actions: [] };
  }
  const out: HttpsCheck =
    input.pageProtocol === 'https:'
      ? {
          id: 'https',
          status: 'error',
          reason: 'http-blocked',
          actions: ['use-https', 'local-file', 'proxy-future'],
        }
      : { id: 'https', status: 'warning', reason: 'http-local', actions: ['use-https'] };
  if (input.httpsAvailable === true) out.httpsAvailable = true;
  return out;
}

/** Outcome of the one lightweight API request (or why none was made). */
export type ApiProbe =
  | { outcome: 'ok' }
  | { outcome: 'error'; error: NetError }
  | { outcome: 'offline' }
  | { outcome: 'no-secret' }
  | { outcome: 'invalid-address' }
  | { outcome: 'not-applicable' };

/**
 * API access / CORS (RESEARCH.md §6.2), from the `NetError` classification of core/net. A server
 * that answered with an HTTP error or a rejection was reachable: the browser let the response
 * through, so CORS is not the problem.
 */
export function checkApi(probe: ApiProbe, kind: SourceKind): ApiCheck {
  const result = (
    status: CheckStatus,
    reason: ApiReason,
    actions: DiagnosticAction[] = [],
  ): ApiCheck => ({ id: 'api', status, reason, actions });
  switch (probe.outcome) {
    case 'ok':
      return result('ok', 'ok');
    case 'offline':
      return result('skipped', 'offline', ['check-network']);
    case 'no-secret':
      return result('skipped', 'no-secret', ['check-credentials']);
    case 'invalid-address':
      return result('error', 'invalid-address', ['check-credentials']);
    case 'not-applicable':
      return result('skipped', 'not-applicable');
  }
  const { error } = probe;
  switch (error.kind) {
    case 'auth':
      // Only an Xtream login can be rejected; an M3U URL answering 401/403 is a provider refusal.
      return kind === 'xtream'
        ? result('warning', 'auth-rejected', ['check-credentials'])
        : result('error', 'http-error', ['contact-provider']);
    case 'blocked':
      if (error.hint === 'mixed-content') {
        return result('error', 'mixed-content', ['use-https', 'local-file', 'proxy-future']);
      }
      if (error.hint === 'cors') {
        return result('error', 'cors', ['local-file', 'contact-provider', 'proxy-future']);
      }
      return result('error', 'network-error', ['check-network', 'retry']);
    case 'offline':
      return result('skipped', 'offline', ['check-network']);
    case 'timeout':
      return result('error', 'timeout', ['check-network', 'retry']);
    case 'aborted':
      return result('error', 'network-error', ['retry']);
    case 'http': {
      const out = result('error', 'http-error', ['retry', 'contact-provider']);
      if (error.status !== undefined) out.httpStatus = error.status;
      return out;
    }
    case 'parse':
      return result('error', 'invalid-response', ['check-credentials', 'contact-provider']);
  }
}

/** Which engine would play live TS and HLS here (the player's own selection, PLY-01). */
export function liveFormatSupport(caps: PlaybackCaps): LiveFormatSupport {
  return {
    ts: selectEngine({ url: '', kind: 'live', container: 'ts' }, caps),
    hls: selectEngine({ url: '', kind: 'live', container: 'hls' }, caps),
  };
}

const playable = (engine: EngineChoice) => engine !== 'unsupported';

/** `allowed_output_formats` contains a format (`m3u8` also matches `hls`). */
function allows(allowed: readonly string[], format: 'ts' | 'm3u8'): boolean {
  const names = allowed.map((f) => f.trim().toLowerCase());
  return format === 'ts' ? names.includes('ts') : names.some((f) => f === 'm3u8' || f === 'hls');
}

/**
 * Live format (RESEARCH.md §5.1–5.2). Xtream: the list's preference against what the account
 * allows (when the API answered) and what this browser plays. M3U: each channel's address decides
 * its format, so only what the browser can play is reported.
 */
export function checkLiveFormat(input: {
  kind: SourceKind;
  configured?: LiveFormat;
  allowed?: string[];
  caps: PlaybackCaps;
}): LiveFormatCheck {
  const support = liveFormatSupport(input.caps);
  const ts = playable(support.ts);
  const hls = playable(support.hls);
  const base = { id: 'liveFormat' as const, support };

  if (input.kind !== 'xtream') {
    if (ts && hls) return { ...base, status: 'ok', reason: 'per-channel', actions: [] };
    return {
      ...base,
      status: ts || hls ? 'warning' : 'error',
      reason: ts || hls ? 'per-channel-partial' : 'none-playable',
      actions: safariIf(input.caps),
    };
  }

  const configured = input.configured ?? 'auto';
  const allowed =
    input.allowed !== undefined && input.allowed.length > 0 ? input.allowed : undefined;
  const xtream = { ...base, configured, ...(allowed ? { allowed } : {}) };
  const tsOk = ts && (allowed === undefined || allows(allowed, 'ts'));
  const hlsOk = hls && (allowed === undefined || allows(allowed, 'm3u8'));

  if (!tsOk && !hlsOk) {
    return { ...xtream, status: 'error', reason: 'none-playable', actions: safariIf(input.caps) };
  }
  if (configured === 'auto') return { ...xtream, status: 'ok', reason: 'ok', actions: [] };

  const wanted = configured === 'ts' ? 'ts' : 'm3u8';
  // The other explicit format when it works here, otherwise "auto" (TS first, HLS fallback).
  const other: LiveFormat = configured === 'ts' ? 'm3u8' : 'ts';
  const suggested: LiveFormat = (other === 'ts' ? tsOk : hlsOk) ? other : 'auto';
  const switchTo = {
    status: 'warning' as const,
    actions: ['switch-live-format' as const],
    suggested,
  };
  if (allowed !== undefined && !allows(allowed, wanted)) {
    return { ...xtream, ...switchTo, reason: 'format-not-allowed' };
  }
  if (!(configured === 'ts' ? ts : hls)) {
    return { ...xtream, ...switchTo, reason: 'format-unplayable' };
  }
  return { ...xtream, status: 'ok', reason: 'ok', actions: [] };
}

/** Outcome of the live stream test (PLY-06), or why it did not run. */
export type LiveStreamOutcome =
  | { outcome: 'probed'; probes: LiveStreamProbe[] }
  | { outcome: 'no-channels' | 'offline' | 'no-secret' | 'unavailable' };

/** Whether a finding stops that format from playing with its engine here. */
function blocks(probe: LiveStreamProbe): boolean {
  return probe.engine === 'unsupported' || probeImpact(probe.finding) === 'blocking';
}

function actionsFor(finding: ProbeFinding, caps: PlaybackCaps): DiagnosticAction[] {
  if (MIXED_CONTENT_FINDINGS.has(finding)) return ['device-app', 'contact-provider'];
  switch (finding) {
    case 'no-cors':
      return [...safariIf(caps), 'contact-provider', 'proxy-future'];
    case 'unreachable':
      return ['check-network', 'contact-provider'];
    case 'auth':
      return ['check-credentials'];
    case 'http-error':
    case 'not-media':
    case 'timeout':
      return ['retry', 'contact-provider'];
    default:
      return [];
  }
}

/**
 * Live stream test (PLY-06): the first live channel of the list, its address(es) probed once
 * (Xtream: TS and HLS). Explains why live channels fail — mixed content after a redirect, http://
 * segments, no CORS, HEVC — and, for Xtream, suggests the live format that works when only one
 * does.
 */
export function checkLiveStream(input: {
  kind: SourceKind;
  outcome: LiveStreamOutcome;
  configured?: LiveFormat;
  caps: PlaybackCaps;
}): LiveStreamCheck {
  const { outcome } = input;
  if (outcome.outcome !== 'probed') {
    const actions: DiagnosticAction[] =
      outcome.outcome === 'offline'
        ? ['check-network']
        : outcome.outcome === 'no-secret'
          ? ['check-credentials']
          : [];
    return {
      id: 'liveStream',
      status: 'skipped',
      reason: outcome.outcome,
      actions,
      probes: [],
      hevc: false,
    };
  }
  const { probes } = outcome;
  const summary = summarizeFindings(
    probes.map((p) => ({ finding: p.finding, hevc: p.result.hevc })),
  );
  const hevc = summary?.hevc ?? false;
  const base = { id: 'liveStream' as const, probes, hevc };
  if (!summary) return { ...base, status: 'skipped', reason: 'unavailable', actions: [] };
  const worst = summary.finding;
  const blocked = probes.filter(blocks);
  // Only a format that answered like a stream "works"; inconclusive ones (native player without
  // CORS, timeout) are neither.
  const working = probes.filter((p) => !blocks(p) && probeImpact(p.finding) === 'fine');

  if (blocked.length === 0) {
    const inconclusive = probes.some((p) => p.finding !== 'ok');
    return {
      ...base,
      status: hevc || inconclusive ? 'warning' : 'ok',
      reason: worst,
      actions: hevc ? safariIf(input.caps) : [],
    };
  }
  if (working.length > 0) {
    const out: LiveStreamCheck = {
      ...base,
      status: 'warning',
      reason: 'partial',
      actions: actionsFor(blocked[0]!.finding, input.caps).filter((a) => a !== 'device-app'),
    };
    const suggested = working[0]!.format;
    if (input.kind === 'xtream' && (input.configured ?? 'auto') !== suggested) {
      out.actions = ['switch-live-format', ...out.actions];
      out.suggested = suggested;
    }
    return out;
  }
  return {
    ...base,
    // Another format could not be checked: it may still play.
    status: blocked.length < probes.length ? 'warning' : 'error',
    reason: worst,
    actions: actionsFor(worst, input.caps),
  };
}

/** Browser support (RESEARCH.md §5.2): MSE, ManagedMediaSource, native HLS. */
export function checkBrowser(caps: PlaybackCaps): BrowserCheck {
  const facts = { mse: caps.mse, mms: caps.mms, nativeHls: caps.nativeHls };
  if (caps.mse) return { id: 'browser', status: 'ok', reason: 'mse', actions: [], ...facts };
  if (caps.mms) return { id: 'browser', status: 'ok', reason: 'mms', actions: [], ...facts };
  if (caps.nativeHls) {
    return {
      id: 'browser',
      status: 'warning',
      reason: 'native-hls-only',
      actions: safariIf(caps),
      ...facts,
    };
  }
  return { id: 'browser', status: 'error', reason: 'none', actions: safariIf(caps), ...facts };
}

/**
 * Codecs (RESEARCH.md §5.3). A codec counts as supported when either playback path supports it.
 * Missing H.264/AAC → most streams fail; missing HEVC/AC-3/E-AC-3 → some channels play without
 * picture or sound.
 */
export function checkCodecs(codecs: CodecSupport[], caps: PlaybackCaps): CodecsCheck {
  const missing = codecs.filter((c) => !c.mediaSource && !c.native).map((c) => c.codec);
  const required = missing.some((c) => REQUIRED_CODECS.has(c));
  const base = { id: 'codecs' as const, codecs, missing };
  if (required) {
    return { ...base, status: 'error', reason: 'required-missing', actions: safariIf(caps) };
  }
  if (missing.length > 0) {
    return { ...base, status: 'warning', reason: 'optional-missing', actions: safariIf(caps) };
  }
  return { ...base, status: 'ok', reason: 'all', actions: [] };
}

/** Worst status first, for a one-line summary. */
export function overallStatus(checks: readonly CheckResult[]): CheckStatus {
  for (const status of ['error', 'warning', 'ok'] as const) {
    if (checks.some((c) => c.status === status)) return status;
  }
  return 'skipped';
}
