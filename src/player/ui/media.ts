// Commands on the <video> element used by PlayerView (PLY-02): playback start under the autoplay
// policy, mute/volume and clamped seeking.
import { log } from '@/core/log';
import { errorName } from '../errors';

export type AutoplayOutcome = 'playing' | 'muted' | 'blocked' | 'failed';

const isNotAllowed = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'NotAllowedError';

/**
 * `video.play()` under the autoplay policy: when the browser refuses unmuted autoplay
 * (`NotAllowedError`), retry muted — the caller then offers an "Unmute" button.
 * `blocked`: even muted autoplay was refused (the user has to press Play).
 * `failed`: play() rejected for another reason (AbortError from a newer load, media error —
 * the controller reports real failures through its `error` event).
 */
export async function startPlayback(
  video: HTMLVideoElement,
  /** Called right before the muted retry (before any of its media events). */
  onMutedRetry?: () => void,
): Promise<AutoplayOutcome> {
  try {
    await video.play();
    return 'playing';
  } catch (e) {
    if (!isNotAllowed(e)) {
      log.info('player: play() rejected', { error: errorName(e) });
      return 'failed';
    }
    if (video.muted) return 'blocked';
  }
  onMutedRetry?.();
  video.muted = true;
  try {
    await video.play();
    return 'muted';
  } catch (e) {
    log.info('player: muted autoplay rejected', { error: errorName(e) });
    video.muted = false;
    return 'blocked';
  }
}

/** User-initiated play (a gesture, so the autoplay policy does not apply). */
export function playMedia(video: HTMLVideoElement): void {
  Promise.resolve(video.play()).catch((e: unknown) =>
    log.info('player: play() rejected', { error: errorName(e) }),
  );
}

/** Whether the user hears nothing: muted, or volume at 0 (both shown as "muted"). */
export function isSilent(video: HTMLVideoElement): boolean {
  return video.muted || video.volume === 0;
}

/**
 * Mutes, or unmutes so that sound is actually heard: a volume left at 0 (slider dragged to the
 * end) is restored to `restoreVolume` (the last non-zero volume).
 */
export function setMediaMuted(video: HTMLVideoElement, muted: boolean, restoreVolume = 1): void {
  if (muted) {
    video.muted = true;
    return;
  }
  if (video.volume === 0) video.volume = restoreVolume > 0 ? Math.min(1, restoreVolume) : 1;
  video.muted = false;
}

/** Sets the volume (0–1); a non-zero volume also unmutes. */
export function setMediaVolume(video: HTMLVideoElement, volume: number): void {
  video.volume = Math.min(1, Math.max(0, volume));
  if (volume > 0 && video.muted) video.muted = false;
}

/** Distance kept from the live edge when the target duration is unknown (seconds). */
export const LIVE_EDGE_MIN_OFFSET_S = 10;

/**
 * A safe position near the live edge of the seekable window `[start, end]`: seeking exactly to
 * `end` stalls (the next segment is not there yet), so stay `max(3 × targetDuration, 10 s)`
 * behind it, clamped into the window.
 */
export function liveEdgePosition(start: number, end: number, targetDuration?: number): number {
  const offset = Math.max(
    targetDuration !== undefined && targetDuration > 0 ? 3 * targetDuration : 0,
    LIVE_EDGE_MIN_OFFSET_S,
  );
  return Math.min(end, Math.max(start, end - offset));
}

/** Seeks to `time`, clamped to `[min, max]`. */
export function seekMedia(video: HTMLVideoElement, time: number, min: number, max: number): void {
  video.currentTime = Math.min(max, Math.max(min, time));
}
