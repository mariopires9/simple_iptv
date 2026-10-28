// Player keyboard shortcuts (PLY-02 AC4, docs/UX_UI.md §4.5). Listened on the player region, so
// they only apply while focus is inside the player; never while typing in a text field.
import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  togglePlay?: (() => void) | undefined;
  toggleFullscreen?: (() => void) | undefined;
  toggleMute?: (() => void) | undefined;
  /** ←/→: seconds to move (negative = back). */
  seekBy?: ((delta: number) => void) | undefined;
  previous?: (() => void) | undefined;
  next?: (() => void) | undefined;
  toggleChannelList?: (() => void) | undefined;
  close?: (() => void) | undefined;
}

export const SEEK_STEP_S = 10;

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

/** A field where keys produce text (shortcuts must never interfere). */
function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // `isContentEditable` is missing in some environments (jsdom); ARIA text widgets count too.
  return (
    el.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
    el.matches('[role="textbox"], [role="searchbox"], [role="combobox"]')
  );
}

/** Controls that handle the arrow keys themselves (sliders). */
function ownsArrows(el: Element): boolean {
  return (el instanceof HTMLInputElement && el.type === 'range') || el.matches('[role="slider"]');
}

/** Controls activated by Space (buttons, links, checkboxes…): Space must reach them. */
function ownsSpace(el: Element): boolean {
  return el.matches('button, a[href], input, [role="button"], [role="checkbox"], [role="switch"]');
}

/** Attaches the shortcuts to `region` (keydown bubbling from anything inside it). */
export function useShortcuts(region: HTMLElement | null, handlers: ShortcutHandlers): void {
  // Latest handlers without re-subscribing on every render.
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!region) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : region;
      if (isTextEntry(target)) return;
      const h = ref.current;
      let action: (() => void) | undefined;
      switch (event.key) {
        case ' ':
        case 'Spacebar':
          if (!ownsSpace(target)) action = h.togglePlay;
          break;
        case 'k':
        case 'K':
          action = h.togglePlay;
          break;
        case 'f':
        case 'F':
          action = h.toggleFullscreen;
          break;
        case 'm':
        case 'M':
          action = h.toggleMute;
          break;
        case 'l':
        case 'L':
          action = h.toggleChannelList;
          break;
        case 'Escape':
          action = h.close;
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          const seekBy = h.seekBy;
          if (seekBy && !ownsArrows(target)) {
            const delta = event.key === 'ArrowLeft' ? -SEEK_STEP_S : SEEK_STEP_S;
            action = () => seekBy(delta);
          }
          break;
        }
        case 'ArrowUp':
          if (!ownsArrows(target)) action = h.previous;
          break;
        case 'ArrowDown':
          if (!ownsArrows(target)) action = h.next;
          break;
      }
      if (!action) return;
      event.preventDefault();
      // Holding a key auto-repeats it: only seeking (←/→) may repeat; toggles, zapping and
      // close act once per press.
      const repeatable = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      if (event.repeat && !repeatable) return;
      action();
    };
    region.addEventListener('keydown', onKeyDown);
    return () => region.removeEventListener('keydown', onKeyDown);
  }, [region]);
}
