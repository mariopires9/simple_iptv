// What the player UI needs to know about the device (PLY-03). Detected once, injectable in tests.
import { getCapabilities } from '@/core/platform';

export interface PlayerPlatform {
  /** Element Fullscreen API (otherwise the iPhone system player, when the element has it). */
  fullscreenApi: boolean;
  /** Picture-in-Picture (standard API or Safari's presentation mode). */
  pip: boolean;
  /** Phone/tablet: landscape → fullscreen by default, orientation lock on entering. */
  mobile: boolean;
}

let detected: PlayerPlatform | undefined;

export function detectPlayerPlatform(): PlayerPlatform {
  if (!detected) {
    const caps = getCapabilities();
    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    detected = { fullscreenApi: caps.fullscreenApi, pip: caps.pip, mobile: caps.isIOS || coarse };
  }
  return detected;
}
