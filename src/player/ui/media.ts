// Commands on the <video> element used by PlayerView (PLY-02): playback start under the autoplay
// policy, mute/volume and clamped seeking.
import { log } from '@/core/log';

export type AutoplayOutcome = 'playing' | 'muted' | 'blocked' | 'failed';

const errorName = (e: unknown) => (e instanceof Error ? e.name : typeof e);
const isNotAllowed = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'NotAllowedError';

/**
 * `video.play()` under the autoplay policy: when the browser refuses unmuted autoplay
 * (`NotAllowedError`), retry muted — the caller then offers an "Unmute" button.
 * `blocked`: even muted autoplay was refused (the user has to press Play).
 * `failed`: play() rejected for another reason (AbortError from a newer load, media error —
 * the controller reports real failures through its `error` event).
 */
export async function startPlayback(video: HTMLVideoElement): Promise<AutoplayOutcome> {
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

export function setMediaMuted(video: HTMLVideoElement, muted: boolean): void {
  video.muted = muted;
}

/** Sets the volume (0–1); a non-zero volume also unmutes. */
export function setMediaVolume(video: HTMLVideoElement, volume: number): void {
  video.volume = Math.min(1, Math.max(0, volume));
  if (volume > 0 && video.muted) video.muted = false;
}

/** Seeks to `time`, clamped to `[min, max]`. */
export function seekMedia(video: HTMLVideoElement, time: number, min: number, max: number): void {
  video.currentTime = Math.min(max, Math.max(min, time));
}
