// Immersive player on a phone turned sideways (PLY-09). Browsers only allow the Fullscreen API
// from a user gesture, and a rotation is not one; iOS Safari only has the system video player.
// So, on a touch phone in landscape, the player region becomes a CSS "pseudo-fullscreen": fixed
// over the whole viewport, with everything outside it hidden (`visibility: hidden`, so the page
// layout underneath does not change), `inert` and `aria-hidden`. Nothing is re-mounted: playback,
// position and focus are kept when the phone turns back to portrait.
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** A touch phone held sideways (tablets in landscape are taller than 600 px). */
export const IMMERSIVE_QUERY =
  '(pointer: coarse) and (orientation: landscape) and (max-height: 600px)';

/** Marks the elements this module hid; global styles make them `visibility: hidden`. */
export const IMMERSIVE_HIDDEN_ATTR = 'data-immersive-hidden';

/** Whether a media query matches, following its changes. `false` without `matchMedia`. */
export function useMediaQueryMatch(query: string, enabled = true): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query, enabled],
  );
  const snapshot = () =>
    enabled && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Elements that never render anything: left alone. */
const NON_VISUAL = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

/**
 * While `active`, hides every element outside `element` (the siblings of it and of each of its
 * ancestors up to `<body>`): `inert`, `aria-hidden` and `IMMERSIVE_HIDDEN_ATTR`. Only what this
 * hook added is removed afterwards (an element already inert or aria-hidden keeps it).
 */
export function useHideOutside(element: HTMLElement | null, active: boolean): void {
  useEffect(() => {
    if (!active || !element) return undefined;
    const undo: Array<() => void> = [];
    const set = (el: Element, name: string, value: string) => {
      if (el.hasAttribute(name)) return;
      el.setAttribute(name, value);
      undo.push(() => el.removeAttribute(name));
    };
    for (let node: Element = element; node.parentElement; node = node.parentElement) {
      if (node === document.body) break;
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || NON_VISUAL.has(sibling.tagName)) continue;
        set(sibling, 'inert', '');
        set(sibling, 'aria-hidden', 'true');
        set(sibling, IMMERSIVE_HIDDEN_ATTR, '');
      }
    }
    return () => undo.forEach((u) => u());
  }, [element, active]);
}
