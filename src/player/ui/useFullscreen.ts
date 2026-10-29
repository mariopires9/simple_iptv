// Fullscreen and orientation for the player (PLY-03, docs/RESEARCH.md §6.3).
// - Fullscreen API available: the player region (with its own overlay) goes fullscreen.
// - Otherwise (iPhone): `video.webkitEnterFullscreen()` — the system player with its own
//   controls; the UI shows a note saying so.
// - Mobile: browsers refuse fullscreen requests without a user gesture, and a rotation is not
//   one. So rotating to landscape during playback (when enabled) shows a transient "Tap for
//   fullscreen" prompt; the tap is the gesture. Rotating back to portrait leaves fullscreen only
//   if it was entered from that prompt. `screen.orientation.lock('landscape')` only where it
//   exists; its (frequent) rejections are swallowed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/core/log';
import { errorName } from '../errors';

export type FullscreenMode = 'element' | 'native-video' | 'none';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type NativeFsVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};
type LockableOrientation = {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

const LANDSCAPE_QUERY = '(orientation: landscape)';

function fullscreenElement(): Element | null {
  const doc = document as FsDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function orientation(): LockableOrientation | undefined {
  const scr = (globalThis as { screen?: { orientation?: LockableOrientation } }).screen;
  return scr?.orientation ?? undefined;
}

/** Runs a call that may throw synchronously or return a rejecting promise; logs, never throws. */
function attempt(what: string, call: () => unknown): Promise<boolean> {
  try {
    return Promise.resolve(call()).then(
      () => true,
      (e: unknown) => {
        log.info(`player: ${what} refused`, { error: errorName(e) });
        return false;
      },
    );
  } catch (e) {
    log.info(`player: ${what} refused`, { error: errorName(e) });
    return Promise.resolve(false);
  }
}

/** Which fullscreen the platform offers for this element. Pure feature detection. */
export function fullscreenMode(
  fullscreenApi: boolean,
  video: HTMLVideoElement | null,
): FullscreenMode {
  if (fullscreenApi) return 'element';
  if (video && typeof (video as NativeFsVideo).webkitEnterFullscreen === 'function') {
    return 'native-video';
  }
  return 'none';
}

export interface FullscreenOptions {
  region: HTMLElement | null;
  video: HTMLVideoElement | null;
  /** Element Fullscreen API available (`Capabilities.fullscreenApi`). */
  fullscreenApi: boolean;
  /** Lock the orientation to landscape on entering (mobile). */
  lockLandscape: boolean;
  /** Offer fullscreen on rotation to landscape (only while `playing`); leave it on portrait. */
  autoOnLandscape: boolean;
  playing: boolean;
}

export interface FullscreenControl {
  mode: FullscreenMode;
  active: boolean;
  toggle(): void;
  exit(): void;
  /** iPhone: the system player was opened; the note about its controls is showing. */
  nativeNote: boolean;
  dismissNativeNote(): void;
  /** The device turned to landscape during playback: offer fullscreen (needs a tap). */
  rotationPrompt: boolean;
  /** The tap on the prompt: the user gesture that enters fullscreen. */
  acceptRotationPrompt(): void;
}

export function useFullscreen({
  region,
  video,
  fullscreenApi,
  lockLandscape,
  autoOnLandscape,
  playing,
}: FullscreenOptions): FullscreenControl {
  const mode = fullscreenMode(fullscreenApi, video);
  const [active, setActive] = useState(false);
  const [nativeNote, setNativeNote] = useState(false);
  const locked = useRef(false);
  /** Fullscreen was actually entered from the rotation prompt (so portrait leaves it). */
  const byRotation = useRef(false);
  /** An enter() from the rotation prompt is in flight (confirmed by the change events). */
  const fromPrompt = useRef(false);
  const [rotationPrompt, setRotationPrompt] = useState(false);

  const unlock = useCallback(() => {
    if (!locked.current) return;
    locked.current = false;
    const o = orientation();
    if (typeof o?.unlock === 'function') void attempt('orientation unlock', () => o.unlock?.());
  }, []);

  // Track the state, whoever changed it (button, Esc handled by the browser, system player).
  useEffect(() => {
    if (mode === 'element' && region) {
      const sync = () => {
        const now = fullscreenElement() === region;
        setActive(now);
        if (now) {
          byRotation.current = fromPrompt.current;
        } else {
          byRotation.current = false;
          unlock();
        }
        fromPrompt.current = false;
      };
      sync();
      document.addEventListener('fullscreenchange', sync);
      document.addEventListener('webkitfullscreenchange', sync);
      return () => {
        document.removeEventListener('fullscreenchange', sync);
        document.removeEventListener('webkitfullscreenchange', sync);
      };
    }
    if (mode === 'native-video' && video) {
      // The system player's own events are the only source of truth for its state.
      const begin = () => {
        setActive(true);
        byRotation.current = fromPrompt.current;
        fromPrompt.current = false;
      };
      const end = () => {
        setActive(false);
        byRotation.current = false;
        fromPrompt.current = false;
      };
      video.addEventListener('webkitbeginfullscreen', begin);
      video.addEventListener('webkitendfullscreen', end);
      return () => {
        video.removeEventListener('webkitbeginfullscreen', begin);
        video.removeEventListener('webkitendfullscreen', end);
      };
    }
    return undefined;
  }, [mode, region, video, unlock]);

  const enter = useCallback(
    (viaPrompt = false) => {
      fromPrompt.current = viaPrompt;
      if (mode === 'element' && region) {
        const el = region as FsElement;
        const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
        if (typeof request !== 'function') {
          fromPrompt.current = false;
          return;
        }
        void attempt('fullscreen', () => request.call(el)).then((ok) => {
          if (!ok) fromPrompt.current = false;
          const o = orientation();
          if (!ok || !lockLandscape || typeof o?.lock !== 'function') return;
          void attempt('orientation lock', () => o.lock?.('landscape')).then((done) => {
            // Left fullscreen in the meantime: undo at once.
            locked.current = done;
            if (done && fullscreenElement() !== region) unlock();
          });
        });
      } else if (mode === 'native-video' && video) {
        const el = video as NativeFsVideo;
        // Synchronously inside the user gesture: iOS refuses it otherwise.
        void attempt('native fullscreen', () => el.webkitEnterFullscreen?.()).then((ok) => {
          if (ok) setNativeNote(true);
          else fromPrompt.current = false;
        });
      } else {
        fromPrompt.current = false;
      }
    },
    [mode, region, video, lockLandscape, unlock],
  );

  const exit = useCallback(() => {
    byRotation.current = false;
    if (mode === 'element') {
      const doc = document as FsDocument;
      if (fullscreenElement() !== region) return;
      const leave = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (typeof leave === 'function') void attempt('exit fullscreen', () => leave.call(doc));
      unlock();
    } else if (mode === 'native-video' && video && active) {
      const el = video as NativeFsVideo;
      void attempt('exit native fullscreen', () => el.webkitExitFullscreen?.());
    }
  }, [mode, region, video, active, unlock]);

  const toggle = useCallback(() => {
    if (active) exit();
    else enter();
  }, [active, enter, exit]);

  // Rotation (mobile): landscape offers fullscreen, portrait leaves a prompt-entered one.
  const latest = useRef({ active, playing, exit });
  useEffect(() => {
    latest.current = { active, playing, exit };
  });
  useEffect(() => {
    if (!autoOnLandscape || mode === 'none' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(LANDSCAPE_QUERY);
    const onChange = () => {
      const s = latest.current;
      if (query.matches) {
        if (s.playing && !s.active) setRotationPrompt(true);
        return;
      }
      setRotationPrompt(false);
      if (s.active && byRotation.current) s.exit();
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [autoOnLandscape, mode]);

  // Leaving the player: give the screen back (fullscreen, orientation lock).
  useEffect(() => {
    if (mode !== 'element' || !region) return undefined;
    return () => {
      if (fullscreenElement() === region) {
        const doc = document as FsDocument;
        const leave = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (typeof leave === 'function') void attempt('exit fullscreen', () => leave.call(doc));
      }
      unlock();
    };
  }, [mode, region, unlock]);

  // The note on the system player's controls stays while the system player is open and
  // disappears by itself a while after the user is back.
  useEffect(() => {
    if (!nativeNote || active) return undefined;
    const timer = setTimeout(() => setNativeNote(false), NATIVE_NOTE_MS);
    return () => clearTimeout(timer);
  }, [nativeNote, active]);

  // The prompt is transient.
  useEffect(() => {
    if (!rotationPrompt) return undefined;
    const timer = setTimeout(() => setRotationPrompt(false), ROTATION_PROMPT_MS);
    return () => clearTimeout(timer);
  }, [rotationPrompt]);

  const acceptRotationPrompt = useCallback(() => {
    setRotationPrompt(false);
    enter(true);
  }, [enter]);

  return {
    mode,
    active,
    toggle,
    exit,
    nativeNote,
    dismissNativeNote: useCallback(() => setNativeNote(false), []),
    rotationPrompt: rotationPrompt && !active,
    acceptRotationPrompt,
  };
}

/** How long the "Tap for fullscreen" prompt stays after turning the device to landscape. */
export const ROTATION_PROMPT_MS = 4000;

/** How long the iPhone note about the system player's controls stays visible. */
export const NATIVE_NOTE_MS = 8000;
