// One PlayerController per <video> element (PLY-02): created when the element mounts, stopped
// (engine destroyed, element emptied) when it unmounts or is replaced.
import { useCallback, useRef, useState } from 'react';
import { log } from '@/core/log';
import { createPlayerController } from '../controller';
import type { PlayerController } from '../controller';

export type ControllerFactory = (video: HTMLVideoElement) => PlayerController;

const defaultFactory: ControllerFactory = (video) => createPlayerController(video);

export interface BoundController {
  video: HTMLVideoElement;
  controller: PlayerController;
}

/**
 * Returns the ref callback for the <video> element and the controller bound to it (undefined
 * until the element is mounted). `factory` is read once per element (tests inject a fake).
 */
export function usePlayerController(factory: ControllerFactory = defaultFactory): {
  videoRef: (video: HTMLVideoElement | null) => (() => void) | undefined;
  bound: BoundController | undefined;
} {
  const factoryRef = useRef(factory);
  const [bound, setBound] = useState<BoundController>();

  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return undefined;
    const controller = factoryRef.current(video);
    setBound({ video, controller });
    return () => {
      setBound((current) => (current?.controller === controller ? undefined : current));
      controller.stop().catch((e: unknown) => {
        log.warn('player: stop on unmount failed', {
          error: e instanceof Error ? e.name : typeof e,
        });
      });
    };
  }, []);

  return { videoRef, bound };
}
