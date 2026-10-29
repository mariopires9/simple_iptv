// "Recent" bookkeeping (LIV-02 AC5): a channel counts as watched after RECENT_AFTER_MS of actual
// playback — time between `playing` (or `timeupdate` progress) and the next pause, buffering
// wait or teardown — so zapping past a channel, or one that never starts, does not record it.
// `stalled` is not a stop: it only means the network is slow to deliver, and fires during normal
// MSE playback while the buffer still plays.
import { useEffect, useRef } from 'react';

export const RECENT_AFTER_MS = 5_000;

const STOP_EVENTS = ['pause', 'waiting', 'emptied', 'ended', 'error'] as const;

/**
 * Listens (capture phase: media events do not bubble) to the <video> inside `container` and
 * calls `onWatched(key)` once per `key` after `ms` of playback. `key` undefined = not counting
 * (e.g. the new channel's stream has not been handed to the player yet).
 */
export function useWatchTimer(
  container: HTMLElement | null,
  key: string | undefined,
  onWatched: (key: string) => void,
  ms = RECENT_AFTER_MS,
): void {
  const callback = useRef(onWatched);
  useEffect(() => {
    callback.current = onWatched;
  });

  useEffect(() => {
    if (!container || key === undefined) return undefined;
    let remaining = ms;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const start = () => {
      if (done || timer !== undefined) return;
      startedAt = Date.now();
      timer = setTimeout(() => {
        timer = undefined;
        done = true;
        callback.current(key);
      }, remaining);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    // Progress resumes counting too (some engines recover from `waiting` without `playing`).
    let lastTime = -1;
    const onTime = (event: Event) => {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      const advanced = media.currentTime > lastTime;
      lastTime = media.currentTime;
      if (advanced && !media.paused && lastTime > 0) start();
    };
    container.addEventListener('playing', start, true);
    container.addEventListener('timeupdate', onTime, true);
    for (const type of STOP_EVENTS) container.addEventListener(type, stop, true);
    return () => {
      stop();
      container.removeEventListener('playing', start, true);
      container.removeEventListener('timeupdate', onTime, true);
      for (const type of STOP_EVENTS) container.removeEventListener(type, stop, true);
    };
  }, [container, key, ms]);
}
