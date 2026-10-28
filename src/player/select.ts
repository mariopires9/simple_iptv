// Engine selection (PLY-01, docs/RESEARCH.md §5.2, docs/ARCHITECTURE.md §6.2).
import type { Capabilities } from '@/core/platform';
import type { EngineId, StreamDescriptor } from './types';

export type EngineChoice = EngineId | 'unsupported';

/** Capabilities that selection reads. */
export type SelectionCapabilities = Pick<Capabilities, 'mse' | 'mms' | 'nativeHls' | 'isSafari'>;

/**
 * Picks the engine for one descriptor (its `fallbacks` are not considered — see
 * {@link planPlayback}):
 * 1. HLS on Safari/iOS (`isSafari` covers every iOS browser) → native first; otherwise hls.js with MSE/MMS; native as a last resort
 *    when the browser reports native HLS but has no MSE/MMS.
 * 2. MPEG-TS and FLV → mpegts.js with MSE/MMS; otherwise unsupported here (for Xtream the
 *    provider puts the `.m3u8` variant in `fallbacks`).
 * 3. MP4/WebM/MOV → native. MKV → native, best effort (Chrome plays most files, Safari/Firefox
 *    usually do not; the failure is reported as `unsupported-container`).
 * 4. AVI and unknown containers → unsupported.
 */
export function selectEngine(
  descriptor: StreamDescriptor,
  caps: SelectionCapabilities,
): EngineChoice {
  const mediaSource = caps.mse || caps.mms;
  switch (descriptor.container) {
    case 'hls':
      if (caps.isSafari && caps.nativeHls) return 'native';
      if (mediaSource) return 'hls';
      return caps.nativeHls ? 'native' : 'unsupported';
    case 'ts':
    case 'flv':
      return mediaSource ? 'mpegts' : 'unsupported';
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'mkv':
      return 'native';
    case 'avi':
    case 'unknown':
      return 'unsupported';
  }
}

export interface PlaybackCandidate {
  descriptor: StreamDescriptor;
  engine: EngineChoice;
}

/** The descriptor followed by its (flat) fallbacks, each with its engine choice. */
export function planPlayback(
  descriptor: StreamDescriptor,
  caps: SelectionCapabilities,
): PlaybackCandidate[] {
  return [descriptor, ...(descriptor.fallbacks ?? [])].map((d) => ({
    descriptor: d,
    engine: selectEngine(d, caps),
  }));
}
