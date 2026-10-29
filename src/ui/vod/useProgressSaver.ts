// Saves the playback position of a VOD <video> (VOD-03 AC1, SER-03 AC1): every 10 s while
// playing, on pause, on `ended` (completed), when the page is hidden or left (`visibilitychange`,
// `pagehide`) and when the player closes (unmount).
//
// - Nothing is saved before the media has played past its first second: a resume seek still in
//   flight (currentTime 0) must not overwrite the saved position.
// - The last known position is cached on every `timeupdate`: on unmount the player engine has
//   already emptied the element, so its `currentTime` is gone.
// - Consecutive identical snapshots are written once.
import { useEffect, useRef } from 'react';
import { SAVE_INTERVAL_MS, progressSnapshot, type ProgressSnapshot } from './resume';

/** Below this position (s) playback has not really started. */
const STARTED_SEC = 1;

export function useProgressSaver(
  video: HTMLVideoElement | null,
  save: ((snapshot: ProgressSnapshot) => void) | undefined,
  intervalMs = SAVE_INTERVAL_MS,
): void {
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!video) return undefined;
    let position = 0;
    let duration: number | undefined;
    let started = false;
    /** Reached the end (until played again). */
    let finished = false;
    let last: string | undefined;

    const read = () => {
      const now = video.currentTime;
      if (Number.isFinite(now) && now >= STARTED_SEC) {
        position = now;
        started = true;
      }
      if (Number.isFinite(video.duration) && video.duration > 0) duration = video.duration;
    };
    const snapshot = () =>
      progressSnapshot(
        finished && duration !== undefined ? duration : position,
        duration,
        finished,
      );
    const write = () => {
      read();
      if (!started || !saveRef.current) return;
      const next = snapshot();
      const id = JSON.stringify(next);
      if (id === last) return;
      last = id;
      saveRef.current(next);
    };

    const onPause = () => {
      // The `pause` that precedes `ended` is the end itself.
      if (!video.ended) write();
    };
    const onEnded = () => {
      finished = true;
      write();
    };
    const onPlay = () => {
      finished = false;
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') write();
    };
    const onPageHide = () => write();
    const timer = setInterval(() => {
      if (!video.paused && !video.ended) write();
    }, intervalMs);

    video.addEventListener('timeupdate', read);
    video.addEventListener('durationchange', read);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('play', onPlay);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(timer);
      video.removeEventListener('timeupdate', read);
      video.removeEventListener('durationchange', read);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', onPlay);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      // Closing the player is an exit too (the element may already be emptied: cached values).
      if (started && saveRef.current) {
        const next = snapshot();
        if (JSON.stringify(next) !== last) saveRef.current(next);
      }
    };
  }, [video, intervalMs]);
}
