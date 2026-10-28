// Auto-hiding player controls (PLY-02 AC3, docs/UX_UI.md §4.5): while playing, the controls hide
// after `delayMs` without interaction and reappear on pointer movement, tap or key. They never
// hide while keyboard focus is inside the controls, while the pointer rests over a control bar
// (elements marked with AUTO_HIDE_KEEP_ATTR) or while `pinned` (e.g. a menu is open).
import { useEffect, useState } from 'react';

export const AUTO_HIDE_DELAY_MS = 3000;
/** Attribute marking the parts of the controls that keep them visible while hovered. */
export const AUTO_HIDE_KEEP_ATTR = 'data-autohide-keep';

export interface AutoHideOptions {
  /** Hiding is only allowed while true (typically: playing, no error). */
  enabled: boolean;
  /** Keeps the controls visible (a menu or dialog is open). */
  pinned?: boolean;
  /** Element whose pointer/key/focus activity reveals the controls (the player region). */
  container: HTMLElement | null;
  /** Controls element: keyboard focus or the pointer over its bars keeps them visible. */
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
  const [hidden, setHidden] = useState(false);
  // Any change of the hiding conditions (pause/play, menu) starts over with visible controls.
  // Adjusted while rendering (React's pattern for state derived from props), not in an effect.
  const [conditions, setConditions] = useState({ enabled, pinned });
  if (conditions.enabled !== enabled || conditions.pinned !== pinned) {
    setConditions({ enabled, pinned });
    setHidden(false);
  }

  useEffect(() => {
    if (!container) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let keyboard = false;
    let hovering = false;

    const keyboardFocusInside = () =>
      keyboard && controls !== null && controls.contains(document.activeElement);

    const arm = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!enabled || pinned) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!hovering && !keyboardFocusInside()) setHidden(true);
      }, delayMs);
    };
    const activity = () => {
      setHidden(false);
      arm();
    };
    const onPointer = (event: Event) => {
      keyboard = false;
      const target = event.target;
      // A touch has no hover (and no pointerleave to end it): only mouse/pen rest over a bar.
      hovering =
        (event as PointerEvent).pointerType !== 'touch' &&
        controls !== null &&
        target instanceof Element &&
        controls.contains(target) &&
        target.closest(`[${AUTO_HIDE_KEEP_ATTR}]`) !== null;
      activity();
    };
    const onPointerLeave = () => {
      hovering = false;
      arm();
    };
    const onKey = () => {
      keyboard = true;
      activity();
    };

    container.addEventListener('pointermove', onPointer);
    container.addEventListener('pointerdown', onPointer);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusin', activity);
    container.addEventListener('focusout', arm);
    arm();
    return () => {
      clearTimeout(timer);
      container.removeEventListener('pointermove', onPointer);
      container.removeEventListener('pointerdown', onPointer);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('keydown', onKey);
      container.removeEventListener('focusin', activity);
      container.removeEventListener('focusout', arm);
    };
  }, [enabled, pinned, container, controls, delayMs]);

  return !enabled || pinned || !hidden;
}
