// What a probe result means for the engine that plays the address (PLY-06). The same result can
// mean different things: "no CORS" stops hls.js and mpegts.js (they fetch the stream), but not
// the native player (Safari HLS), which does not need CORS — there it only means the playlist
// could not be inspected.
import type { EngineChoice } from '../select';
import type { ProbeCause, StreamProbeResult } from './probeStream';

/** Message key of one probe result for one engine (localized under `player.probe.causes`). */
export type ProbeFinding = ProbeCause | 'no-cors-native';

/** How a finding affects playback with that engine. */
export type ProbeImpact = 'blocking' | 'fine' | 'inconclusive';

export function probeFinding(result: StreamProbeResult, engine: EngineChoice): ProbeFinding {
  return result.cause === 'no-cors' && engine === 'native' ? 'no-cors-native' : result.cause;
}

export function probeImpact(finding: ProbeFinding): ProbeImpact {
  switch (finding) {
    case 'ok':
      return 'fine';
    case 'no-cors-native':
    case 'timeout':
    case 'invalid-url':
      return 'inconclusive';
    default:
      return 'blocking';
  }
}

/** Most telling first: the cause shown when several addresses were probed. */
const PRIORITY: readonly ProbeFinding[] = [
  'insecure-url',
  'insecure-redirect',
  'insecure-segments',
  'redirect-blocked',
  'auth',
  'no-cors',
  'unreachable',
  'http-error',
  'not-media',
  'timeout',
  'no-cors-native',
  'invalid-url',
  'ok',
];

/** Findings that mean "http:// content inside an https app": a device app is needed. */
export const MIXED_CONTENT_FINDINGS: ReadonlySet<ProbeFinding> = new Set([
  'insecure-url',
  'insecure-redirect',
  'insecure-segments',
  'redirect-blocked',
]);

export interface ProbeSummary {
  /** The most telling finding. */
  finding: ProbeFinding;
  /** Some probed address declares HEVC. */
  hevc: boolean;
  /** The finding means http:// content in an https app (the stream needs a device app). */
  mixedContent: boolean;
}

/** Summary of the findings of several probes (undefined for none). */
export function summarizeFindings(
  findings: readonly { finding: ProbeFinding; hevc?: boolean | undefined }[],
): ProbeSummary | undefined {
  let best: ProbeFinding | undefined;
  for (const { finding } of findings) {
    if (best === undefined || PRIORITY.indexOf(finding) < PRIORITY.indexOf(best)) best = finding;
  }
  if (best === undefined) return undefined;
  return {
    finding: best,
    hevc: findings.some((f) => f.hevc === true),
    mixedContent: MIXED_CONTENT_FINDINGS.has(best),
  };
}
