// Fakes of the display APIs jsdom lacks (PLY-03): element Fullscreen API, Picture-in-Picture,
// `screen.orientation` and an orientation media query. Each installer returns its controls and
// a `restore()` that removes everything it added.
import { vi } from 'vitest';

type Restore = () => void;

function defineOn(target: object, name: string, descriptor: PropertyDescriptor): Restore {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
  return () => {
    if (previous) Object.defineProperty(target, name, previous);
    else delete (target as Record<string, unknown>)[name];
  };
}

export interface FakeFullscreen {
  readonly request: ReturnType<typeof vi.fn>;
  readonly exit: ReturnType<typeof vi.fn>;
  readonly element: () => Element | null;
  /** The browser leaving fullscreen by itself (e.g. its own Esc handling). */
  leaveExternally(): void;
  /** Next request() rejects (e.g. no user activation). */
  refuseNext(): void;
  restore: Restore;
}

export function installFullscreenApi(): FakeFullscreen {
  let element: Element | null = null;
  let refuse = false;
  const change = () => document.dispatchEvent(new Event('fullscreenchange'));
  const enter = (el: Element) => {
    element = el;
    change();
  };
  const request = vi.fn(async function (this: Element) {
    if (refuse) {
      refuse = false;
      throw new TypeError('Permissions check failed');
    }
    enter(this);
  });
  const exit = vi.fn(async () => {
    element = null;
    change();
  });
  const restores = [
    defineOn(document, 'fullscreenEnabled', { get: () => true }),
    defineOn(document, 'fullscreenElement', { get: () => element }),
    defineOn(document, 'exitFullscreen', { value: exit }),
    defineOn(HTMLElement.prototype, 'requestFullscreen', { value: request }),
  ];
  return {
    request,
    exit,
    element: () => element,
    leaveExternally() {
      element = null;
      change();
    },
    refuseNext() {
      refuse = true;
    },
    restore: () => restores.reverse().forEach((r) => r()),
  };
}

export interface FakeOrientation {
  readonly lock: ReturnType<typeof vi.fn>;
  readonly unlock: ReturnType<typeof vi.fn>;
  restore: Restore;
}

/** `screen.orientation` with `lock`/`unlock`; `lockRejects` mimics desktop browsers. */
export function installOrientationLock(lockRejects = false): FakeOrientation {
  const lock = vi.fn(async () => {
    if (lockRejects) throw new DOMException('not supported', 'NotSupportedError');
  });
  const unlock = vi.fn();
  const restore = defineOn(screen, 'orientation', {
    value: { type: 'portrait-primary', lock, unlock, addEventListener() {} },
  });
  return { lock, unlock, restore };
}

export interface FakeOrientationQuery {
  /** Rotates the device: updates `(orientation: landscape)` and fires its `change`. */
  rotate(landscape: boolean): void;
  listenerCount(): number;
  restore: Restore;
}

export function installOrientationQuery(landscape = false): FakeOrientationQuery {
  let matches = landscape;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return matches;
    },
    media: '(orientation: landscape)',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const matchMedia = vi.fn((media: string) =>
    media === '(orientation: landscape)'
      ? query
      : { matches: false, media, addEventListener() {}, removeEventListener() {} },
  );
  const restore = defineOn(window, 'matchMedia', { value: matchMedia });
  return {
    rotate(value) {
      matches = value;
      for (const cb of [...listeners]) cb();
    },
    listenerCount: () => listeners.size,
    restore,
  };
}

export interface FakePip {
  readonly request: ReturnType<typeof vi.fn>;
  readonly exit: ReturnType<typeof vi.fn>;
  readonly element: () => Element | null;
  restore: Restore;
}

/** Standard Picture-in-Picture API (Chrome, Edge, Safari 13.1+). */
export function installPictureInPicture(): FakePip {
  let element: Element | null = null;
  const enter = (video: HTMLVideoElement) => {
    element = video;
    video.dispatchEvent(new Event('enterpictureinpicture'));
  };
  const request = vi.fn(async function (this: HTMLVideoElement) {
    enter(this);
  });
  const exit = vi.fn(async () => {
    const was = element;
    element = null;
    was?.dispatchEvent(new Event('leavepictureinpicture'));
  });
  const restores = [
    defineOn(document, 'pictureInPictureEnabled', { get: () => true }),
    defineOn(document, 'pictureInPictureElement', { get: () => element }),
    defineOn(document, 'exitPictureInPicture', { value: exit }),
    defineOn(HTMLVideoElement.prototype, 'requestPictureInPicture', { value: request }),
  ];
  return {
    request,
    exit,
    element: () => element,
    restore: () => restores.reverse().forEach((r) => r()),
  };
}

export interface FakeIOSVideo {
  readonly enterFullscreen: ReturnType<typeof vi.fn>;
  readonly setPresentationMode: ReturnType<typeof vi.fn>;
  /** The user closing the system player. */
  endFullscreen(): void;
}

/** iPhone `<video>`: `webkitEnterFullscreen` and `webkitSetPresentationMode` on the element. */
export function makeIOSVideo(video: HTMLVideoElement): FakeIOSVideo {
  let mode = 'inline';
  let displaying = false;
  const enterFullscreen = vi.fn(() => {
    displaying = true;
    video.dispatchEvent(new Event('webkitbeginfullscreen'));
  });
  const setPresentationMode = vi.fn((next: string) => {
    mode = next;
    video.dispatchEvent(new Event('webkitpresentationmodechanged'));
  });
  Object.defineProperties(video, {
    webkitEnterFullscreen: { configurable: true, value: enterFullscreen },
    webkitExitFullscreen: { configurable: true, value: vi.fn() },
    webkitDisplayingFullscreen: { configurable: true, get: () => displaying },
    webkitSetPresentationMode: { configurable: true, value: setPresentationMode },
    webkitPresentationMode: { configurable: true, get: () => mode },
  });
  return {
    enterFullscreen,
    setPresentationMode,
    endFullscreen() {
      displaying = false;
      video.dispatchEvent(new Event('webkitendfullscreen'));
    },
  };
}
