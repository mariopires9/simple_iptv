// One PlayerController per <video> element (PLY-02): created when the element mounts, stopped
// (engine destroyed, element emptied) when it unmounts or is replaced.
import { useCallback, useRef, useState } from 'react';
import { log } from '@/core/log';
import type { UrlRewriter } from '@/core/net';
import { createPlayerController } from '../controller';
import { errorName } from '../errors';
import type { PlayerController } from '../controller';

export interface ControllerFactoryOptions {
  /** Routes the player's requests (e.g. through the personal proxy, PRX-01). */
  rewriter?: UrlRewriter;
}

export type ControllerFactory = (
  video: HTMLVideoElement,
  options?: ControllerFactoryOptions,
) => PlayerController;

const defaultFactory: ControllerFactory = (video, options = {}) =>
  createPlayerController(video, options.rewriter ? { rewriter: options.rewriter } : {});

export interface BoundController {
  video: HTMLVideoElement;
  controller: PlayerController;
}

/**
 * Returns the ref callback for the <video> element and the controller bound to it (undefined
 * until the element is mounted). `factory` is read once per element (tests inject a fake), and
 * so is `rewriter`: pass a stable one (PlayerView passes a delegating rewriter).
 */
export function usePlayerController(
  factory: ControllerFactory = defaultFactory,
  rewriter?: UrlRewriter,
): {
  videoRef: (video: HTMLVideoElement | null) => (() => void) | undefined;
  bound: BoundController | undefined;
} {
  const factoryRef = useRef(factory);
  const rewriterRef = useRef(rewriter);
  const [bound, setBound] = useState<BoundController>();

  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return undefined;
    const options: ControllerFactoryOptions = rewriterRef.current
      ? { rewriter: rewriterRef.current }
      : {};
    const controller = factoryRef.current(video, options);
    setBound({ video, controller });
    return () => {
      setBound((current) => (current?.controller === controller ? undefined : current));
      controller.stop().catch((e: unknown) => {
        log.warn('player: stop on unmount failed', { error: errorName(e) });
      });
    };
  }, []);

  return { videoRef, bound };
}
