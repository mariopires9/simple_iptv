// Codec probes for the compatibility diagnostics (SRC-09 AC1, RESEARCH.md §5.3). The platform
// detection itself (MSE / ManagedMediaSource / native HLS) is `getCapabilities` in core/platform;
// this only asks the same environment about specific codecs, per playback path:
// - `mediaSource`: `MediaSource.isTypeSupported` or `ManagedMediaSource.isTypeSupported` — the
//   path of hls.js and mpegts.js (both feed fragmented MP4 to the browser);
// - `native`: `<video>.canPlayType` — the path of native HLS (Safari) and MP4 files.
import { browserEnv, type MediaSourceLike, type PlatformEnv } from '@/core/platform';

export type CodecId = 'h264' | 'hevc' | 'aac' | 'ac3' | 'eac3';

/** Codecs in display order. H.264 and AAC are what almost every IPTV stream uses. */
export const CODECS: readonly CodecId[] = ['h264', 'aac', 'hevc', 'ac3', 'eac3'];

/** Codecs without which most streams cannot play at all. */
export const REQUIRED_CODECS: ReadonlySet<CodecId> = new Set(['h264', 'aac']);

/** MIME types probed per codec; supported when any of them is. */
export const CODEC_MIME_TYPES: Record<CodecId, readonly string[]> = {
  // High profile, level 3.1 (typical HD live channels).
  h264: ['video/mp4; codecs="avc1.64001f"', 'video/mp4; codecs="avc1.42e01e"'],
  hevc: ['video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'],
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  ac3: ['audio/mp4; codecs="ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"'],
};

export interface CodecSupport {
  codec: CodecId;
  /** Through MSE or ManagedMediaSource (hls.js / mpegts.js). */
  mediaSource: boolean;
  /** Through the `<video>` element (native HLS, MP4). */
  native: boolean;
}

function supports(source: MediaSourceLike | undefined, mime: string): boolean {
  try {
    return typeof source?.isTypeSupported === 'function' && source.isTypeSupported(mime);
  } catch {
    return false;
  }
}

/** Probes every codec of {@link CODECS}. Creates one detached `<video>` (never attached). */
export function probeCodecs(env: PlatformEnv = browserEnv()): CodecSupport[] {
  const video = env.createVideo();
  const canPlay = (mime: string) => {
    try {
      return video.canPlayType(mime) !== '';
    } catch {
      return false;
    }
  };
  return CODECS.map((codec) => {
    const mimes = CODEC_MIME_TYPES[codec];
    return {
      codec,
      mediaSource: mimes.some(
        (mime) => supports(env.MediaSource, mime) || supports(env.ManagedMediaSource, mime),
      ),
      native: mimes.some(canPlay),
    };
  });
}
