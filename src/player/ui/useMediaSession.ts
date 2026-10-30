// Media Session (MSS-01): the title and artwork on the lock screen / system media controls, and
// their play, pause, previous and next buttons. Feature-detected; everything is cleared when the
// player unmounts.
import { useEffect, useRef } from 'react';
import { log } from '@/core/log';
import { errorName } from '../errors';
import { playMedia } from './media';

export interface MediaSessionOptions {
  video: HTMLVideoElement | null;
  title: string;
  /** Channel logo or poster URL; ignored unless http(s). */
  artwork?: string | undefined;
  /** "Previous track" (live: previous channel). */
  onPrevious?: (() => void) | undefined;
  /** "Next track" (live: next channel; series: next episode). */
  onNext?: (() => void) | undefined;
}

const ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack'] as const;
type Action = (typeof ACTIONS)[number];

function mediaSession(): MediaSession | undefined {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : undefined;
}

function setHandler(session: MediaSession, action: Action, handler: (() => void) | null): void {
  try {
    session.setActionHandler(action, handler);
  } catch (e) {
    // An action this browser does not know throws; the others still work.
    log.debug('player: media session action not supported', { action, error: errorName(e) });
  }
}

function isHttpUrl(url: string | undefined): url is string {
  if (url === undefined) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function useMediaSession({
  video,
  title,
  artwork,
  onPrevious,
  onNext,
}: MediaSessionOptions): void {
  const callbacks = useRef({ onPrevious, onNext });
  useEffect(() => {
    callbacks.current = { onPrevious, onNext };
  });

  useEffect(() => {
    const session = mediaSession();
    if (!session || typeof MediaMetadata !== 'function') return undefined;
    try {
      session.metadata = new MediaMetadata({
        title,
        artwork: isHttpUrl(artwork) ? [{ src: artwork }] : [],
      });
    } catch (e) {
      log.debug('player: media session metadata failed', { error: errorName(e) });
    }
    return () => {
      session.metadata = null;
    };
  }, [title, artwork]);

  const hasPrevious = onPrevious !== undefined;
  const hasNext = onNext !== undefined;
  useEffect(() => {
    const session = mediaSession();
    if (!session || !video) return undefined;
    setHandler(session, 'play', () => playMedia(video));
    setHandler(session, 'pause', () => video.pause());
    setHandler(
      session,
      'previoustrack',
      hasPrevious ? () => callbacks.current.onPrevious?.() : null,
    );
    setHandler(session, 'nexttrack', hasNext ? () => callbacks.current.onNext?.() : null);
    return () => {
      for (const action of ACTIONS) setHandler(session, action, null);
    };
  }, [video, hasPrevious, hasNext]);
}
