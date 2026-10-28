// Auto-hiding player controls (PLY-02 AC3, docs/UX_UI.md §4.5): while playing, the controls hide
// after `delayMs` without interaction and reappear on pointer movement, tap or key. They never
// hide while keyboard focus is inside the controls or while `pinned` (e.g. a menu is open).
import { useEffect, useMemo, useState } from 'react';

export const AUTO_HIDE_DELAY_MS = 3000;

export interface AutoHideOptions {
  /** Hiding is only allowed while true (typically: playing, no error). */
  enabled: boolean;
  /** Keeps the controls visible (a menu or dialog is open). */
  pinned?: boolean;
  /** Element whose pointer/key/focus activity reveals the controls (the player region). */
  container: HTMLElement | null;
  /** Controls element: keyboard focus inside it keeps them visible. */
  controls: HTMLElement | null;
  delayMs?: number;
}

/** Whether the controls are visible. */
export function useAutoHide({
  enabled,
  pinned = false,
  container,
  controls,
  delayMs = AUTO_HIDE_DELAY_MS,
}: AutoHideOptions): boolean {
  // A new session whenever the inputs change: a `hidden` flag from an earlier session (e.g.
  // before a pause) is stale, so the controls start visible without a state reset in the effect.
  const session = useMemo(
    () => ({ enabled, pinned, container, controls, delayMs }),
    [enabled, pinned, container, controls, delayMs],
  );
  const [hiddenIn, setHiddenIn] = useState<object | null>(null);

  useEffect(() => {
    if (!container) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keyboard = false;

    const keyboardFocusInside = () =>
      keyboard && controls !== null && controls.contains(document.activeElement);

    const arm = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!enabled || pinned) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!keyboardFocusInside()) setHiddenIn(session);
      }, delayMs);
    };
    const activity = () => {
      setHiddenIn(null);
      arm();
    };
    const onPointer = () => {
      keyboard = false;
      activity();
    };
    const onKey = () => {
      keyboard = true;
      activity();
    };

    container.addEventListener('pointermove', onPointer);
    container.addEventListener('pointerdown', onPointer);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusin', activity);
    container.addEventListener('focusout', arm);
    arm();
    return () => {
      clearTimeout(timer);
      container.removeEventListener('pointermove', onPointer);
      container.removeEventListener('pointerdown', onPointer);
      container.removeEventListener('keydown', onKey);
      container.removeEventListener('focusin', activity);
      container.removeEventListener('focusout', arm);
    };
  }, [session, enabled, pinned, container, controls, delayMs]);

  return !enabled || pinned || hiddenIn !== session;
}
