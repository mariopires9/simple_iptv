// "Video plays but there is no sound" detection (PLY-04 AC3, docs/RESEARCH.md §5.3): channels
// with AC-3/MP2 audio often play muted-by-necessity in Chrome/Firefox. Browsers expose no
// standard signal for it, so this reads the non-standard decoder counters after a few seconds of
// playback. Engines that know better (hls.js dropping the audio SourceBuffer) emit an
// `audio-unsupported` notice instead.

/** Seconds of real playback before the counters are read. */
export const AUDIO_CHECK_DELAY_MS = 4000;

type CountingVideo = HTMLVideoElement & {
  /** Chrome, Safari. */
  webkitAudioDecodedByteCount?: number;
  webkitVideoDecodedByteCount?: number;
  /** Firefox. */
  mozHasAudio?: boolean;
};

/**
 * `true` when the element decoded video but no audio at all. `false` when audio was decoded or
 * the browser exposes no counter (no claim without a signal). A stream with no audio track at all
 * looks the same, which is why the message says "may".
 */
export function audioMissing(video: HTMLVideoElement): boolean {
  const v = video as CountingVideo;
  if (
    typeof v.webkitAudioDecodedByteCount === 'number' &&
    typeof v.webkitVideoDecodedByteCount === 'number'
  ) {
    return v.webkitVideoDecodedByteCount > 0 && v.webkitAudioDecodedByteCount === 0;
  }
  if (typeof v.mozHasAudio === 'boolean') return !v.mozHasAudio && video.videoWidth > 0;
  return false;
}
