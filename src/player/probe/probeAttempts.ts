// Probes the addresses a failed play() tried (PLY-06), one after the other (Xtream accounts are
// often limited to one connection at a time). The attempts of the final error are in plan order,
// so attempt `i` is the descriptor `i` of `[descriptor, ...fallbacks]`. Skipped candidates are not
// probed; an address tried by two engines (M3U guess: TS then HLS) is requested once.
import type { PlaybackAttempt, StreamDescriptor } from '../types';
import { probeFinding, type ProbeFinding } from './interpret';
import { probeStream, type ProbeOptions, type StreamProbeResult } from './probeStream';

export interface AttemptProbe {
  /** Index of the attempt (and of the descriptor in the plan). */
  index: number;
  result: StreamProbeResult;
  finding: ProbeFinding;
}

export async function probeAttempts(
  descriptor: StreamDescriptor,
  attempts: readonly PlaybackAttempt[],
  options: ProbeOptions = {},
): Promise<AttemptProbe[]> {
  const plan = [descriptor, ...(descriptor.fallbacks ?? [])];
  const byUrl = new Map<string, StreamProbeResult>();
  const out: AttemptProbe[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const candidate = plan[index];
    if (!candidate || attempt.engine === 'unsupported') continue;
    if (options.signal?.aborted === true) break;
    let result = byUrl.get(candidate.url);
    if (!result) {
      result = await probeStream(candidate.url, options);
      byUrl.set(candidate.url, result);
    }
    out.push({ index, result, finding: probeFinding(result, attempt.engine) });
  }
  return out;
}
