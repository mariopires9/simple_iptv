// Snapshot of the <video> element state for the controls (PLY-02), refreshed on media events.
import { useEffect, useState } from 'react';

export interface MediaState {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  /** 0–1. */
  volume: number;
  currentTime: number;
  /** `NaN` before metadata, `Infinity` for live streams. */
  duration: number;
  /** First/last seekable position; both 0 when nothing is seekable. */
  seekableStart: number;
  seekableEnd: number;
  /** `waiting` fired and playback has not resumed yet. */
  waiting: boolean;
}

const EVENTS = [
  'play',
  'pause',
  'playing',
  'ended',
  'waiting',
  'canplay',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'loadeddata',
  'progress',
  'volumechange',
  'emptied',
] as const;

const INITIAL: MediaState = {
  paused: true,
  ended: false,
  muted: false,
  volume: 1,
  currentTime: 0,
  duration: Number.NaN,
  seekableStart: 0,
  seekableEnd: 0,
  waiting: false,
};

function read(video: HTMLVideoElement, waiting: boolean): MediaState {
  const seekable = video.seekable as TimeRanges | undefined;
  const last = seekable ? seekable.length - 1 : -1;
  return {
    paused: video.paused,
    ended: video.ended,
    muted: video.muted,
    volume: video.volume,
    currentTime: video.currentTime,
    duration: video.duration,
    seekableStart: seekable && last >= 0 ? seekable.start(0) : 0,
    seekableEnd: seekable && last >= 0 ? seekable.end(last) : 0,
    waiting,
  };
}

/** Media state of `video` (initial state while it is null). */
export function useMediaState(video: HTMLVideoElement | null): MediaState {
  const [state, setState] = useState<MediaState>(INITIAL);
  useEffect(() => {
    if (!video) return undefined;
    let waiting = false;
    let active = true;
    const update = (event?: Event) => {
      if (!active) return;
      switch (event?.type) {
        case 'waiting':
          waiting = true;
          break;
        case 'playing':
        case 'pause':
        case 'canplay':
        case 'seeked':
        case 'ended':
        case 'emptied':
          waiting = false;
          break;
      }
      setState(read(video, waiting));
    };
    for (const type of EVENTS) video.addEventListener(type, update);
    // Sync once: the element may have changed before the listeners were attached.
    queueMicrotask(() => update());
    return () => {
      active = false;
      for (const type of EVENTS) video.removeEventListener(type, update);
    };
  }, [video]);
  return state;
}
