// Picture-in-Picture (PLY-03 AC4): the standard API (`requestPictureInPicture`) or Safari's
// presentation mode (`webkitSetPresentationMode`). Hidden where neither exists.
import { useCallback, useEffect, useState } from 'react';
import { log } from '@/core/log';
import { errorName } from '../errors';

type PipDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};
type PipVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void;
  webkitPresentationMode?: string;
};

type PipApi = 'standard' | 'webkit' | undefined;

function pipApi(video: HTMLVideoElement | null): PipApi {
  if (!video) return undefined;
  const el = video as PipVideo;
  const doc = document as PipDocument;
  if (doc.pictureInPictureEnabled === true && typeof el.requestPictureInPicture === 'function') {
    return 'standard';
  }
  if (typeof el.webkitSetPresentationMode === 'function') return 'webkit';
  return undefined;
}

function isInPip(video: HTMLVideoElement): boolean {
  const doc = document as PipDocument;
  return (
    doc.pictureInPictureElement === video ||
    (video as PipVideo).webkitPresentationMode === 'picture-in-picture'
  );
}

async function run(what: string, call: () => unknown): Promise<void> {
  try {
    await call();
  } catch (e) {
    log.info(`player: ${what} refused`, { error: errorName(e) });
  }
}

function leave(video: HTMLVideoElement): Promise<void> {
  const doc = document as PipDocument;
  if (doc.pictureInPictureElement === video && typeof doc.exitPictureInPicture === 'function') {
    return run('exit picture-in-picture', () => doc.exitPictureInPicture?.());
  }
  const el = video as PipVideo;
  if (el.webkitPresentationMode === 'picture-in-picture') {
    return run('exit picture-in-picture', () => el.webkitSetPresentationMode?.('inline'));
  }
  return Promise.resolve();
}

export interface PictureInPictureControl {
  supported: boolean;
  active: boolean;
  toggle(): void;
}

/** `enabled`: the platform reports PiP (`Capabilities.pip`); the element is checked too. */
export function usePictureInPicture(
  video: HTMLVideoElement | null,
  enabled: boolean,
): PictureInPictureControl {
  const api = enabled ? pipApi(video) : undefined;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!video || api === undefined) return undefined;
    const sync = () => setActive(isInPip(video));
    sync();
    const events = [
      'enterpictureinpicture',
      'leavepictureinpicture',
      'webkitpresentationmodechanged',
    ];
    for (const type of events) video.addEventListener(type, sync);
    return () => {
      for (const type of events) video.removeEventListener(type, sync);
      // Closing the player closes its PiP window too.
      if (isInPip(video)) void leave(video);
    };
  }, [video, api]);

  const toggle = useCallback(() => {
    if (!video || api === undefined) return;
    if (isInPip(video)) {
      void leave(video);
      return;
    }
    const el = video as PipVideo;
    if (api === 'standard') void run('picture-in-picture', () => el.requestPictureInPicture?.());
    else void run('picture-in-picture', () => el.webkitSetPresentationMode?.('picture-in-picture'));
  }, [video, api]);

  return { supported: api !== undefined, active, toggle };
}
