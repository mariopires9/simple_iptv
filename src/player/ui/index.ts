// Player UI (PLY-02). Kept apart from `@/player` so importing player types or the controller does
// not pull the UI (MUI controls) into a bundle: features load this module with a dynamic import.
//
// TEC-01: the player's strings load with this chunk, not with the screens that may open it. The
// load starts when the chunk is evaluated, and the exported `PlayerView` renders nothing until
// the strings are on `t` (usually already the case by its first render). Not a top-level await:
// with one, the bundler splits the shared modules of the initial bundle into extra chunks
// (measured: +3.9 KiB gzip of initial JS).
import { createElement, useEffect, useState } from 'react';
import { claimPlayback } from '@/core/session';
import { ensureMessages, isMessagesLoaded } from '@/i18n';
import { PlayerView as PlayerViewWithStrings, type PlayerViewProps } from './PlayerView';

// Start now; a failure is reported by the first PlayerView that needs the strings (and retried).
ensureMessages('player').catch(() => undefined);

/** `PlayerView` once the `player` strings are loaded; a failed load goes to the error boundary. */
export function PlayerView(props: PlayerViewProps) {
  // PWA-03: while a player is open, an app update is never applied (no reload under playback).
  useEffect(() => claimPlayback(), []);
  const [ready, setReady] = useState(() => isMessagesLoaded('player'));
  const [error, setError] = useState<{ error: unknown }>();
  useEffect(() => {
    if (ready) return;
    let active = true;
    ensureMessages('player').then(
      () => active && setReady(true),
      (cause: unknown) => active && setError({ error: cause }),
    );
    return () => {
      active = false;
    };
  }, [ready]);
  if (error) throw error.error;
  return ready ? createElement(PlayerViewWithStrings, props) : null;
}

export { DVR_MIN_WINDOW_S, BUFFERING_SPINNER_DELAY_MS } from './PlayerView';
export type { PlayerViewProps } from './PlayerView';
export type { ControllerFactory } from './usePlayerController';
export { formatTime } from './formatTime';
