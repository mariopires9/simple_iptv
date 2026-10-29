// "Next episode in 10 s" (SER-03 AC2/AC3): the countdown starts when ≤ 20 s of the episode remain
// (credits are not detectable, so `ended` also starts it), counts down once per second and then
// moves on. It holds while the video is paused (not ended). Cancel stops it for this episode;
// seeking back before the last 20 s re-arms it. Without a next episode nothing is offered.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Remaining time (s) from which the next episode is offered. */
export const OFFER_REMAINING_SEC = 20;
/** Length of the countdown (s). */
export const COUNTDOWN_SEC = 10;

export type NextEpisodePhase =
  { kind: 'idle' } | { kind: 'counting'; seconds: number } | { kind: 'cancelled' };

export function useNextEpisode(
  video: HTMLVideoElement | null,
  hasNext: boolean,
  onAdvance: () => void,
): { phase: NextEpisodePhase; cancel: () => void; playNow: () => void } {
  const [phase, setPhase] = useState<NextEpisodePhase>({ kind: 'idle' });
  const advanceRef = useRef(onAdvance);
  useEffect(() => {
    advanceRef.current = onAdvance;
  });

  // Media events → start (or re-arm) the countdown.
  useEffect(() => {
    if (!video || !hasNext) return undefined;
    const check = () => {
      const { currentTime, duration } = video;
      const near =
        video.ended ||
        (Number.isFinite(duration) &&
          duration > 0 &&
          currentTime > 0 &&
          duration - currentTime <= OFFER_REMAINING_SEC);
      setPhase((current) => {
        if (near && current.kind === 'idle') return { kind: 'counting', seconds: COUNTDOWN_SEC };
        // Seeked back out of the last seconds: offer it again later.
        if (!near && current.kind !== 'idle') return { kind: 'idle' };
        return current;
      });
    };
    video.addEventListener('timeupdate', check);
    video.addEventListener('ended', check);
    video.addEventListener('seeked', check);
    return () => {
      video.removeEventListener('timeupdate', check);
      video.removeEventListener('ended', check);
      video.removeEventListener('seeked', check);
    };
  }, [video, hasNext]);

  // The countdown itself; a paused video (but not one that ended) holds it.
  const counting = phase.kind === 'counting';
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => {
      if (video && video.paused && !video.ended) return;
      setPhase((current) =>
        current.kind === 'counting' ? { kind: 'counting', seconds: current.seconds - 1 } : current,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [counting, video]);
  const done = phase.kind === 'counting' && phase.seconds <= 0;
  useEffect(() => {
    if (done) advanceRef.current();
  }, [done]);

  const cancel = useCallback(() => setPhase({ kind: 'cancelled' }), []);
  const playNow = useCallback(() => advanceRef.current(), []);
  return { phase: hasNext ? phase : { kind: 'idle' }, cancel, playNow };
}
