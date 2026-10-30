// D-pad / TV remote navigation (UX-05). One document listener, in the bubbling phase, so every
// widget sees a key first and keeps it when it handles it (`preventDefault`): the poster grid and
// the channel list move inside themselves, the player zaps, menus move between their items. Only
// what nothing handled becomes a D-pad action:
//   - an arrow moves the focus to the nearest tab stop that way (spatial focus, `findNext`), and
//     OK (Enter) on a native select opens its picker;
//   - "back" (Escape, Backspace outside text fields, GoBack/BrowserBack, Tizen 10009, webOS 461)
//     is offered to the page as Escape first — so it closes the player, a panel, a menu or a
//     dialog exactly like Escape does — and goes back in the history when nothing used it;
//   - with the focus lost (on the body, after the focused element went away), any D-pad key puts
//     it back on the page's main content instead of doing nothing.
// While the D-pad is in use, `<html data-input="dpad">` turns on the larger focus ring
// (`DpadFocusStyles`); a pointer press turns it off.
import {
  caretCanMove,
  directionOf,
  isBackAlias,
  isTextField,
  ownsArrows,
  type Direction,
} from './keys';
import { findNext, isCandidate, tabStopsIn } from './spatial';

export const INPUT_ATTRIBUTE = 'data-input';

export interface DpadOptions {
  /** Goes back one step in the app's history (the router); a no-op on the first entry. */
  back: () => void;
  /** Document to listen on (tests). */
  doc?: Document;
}

function isLost(doc: Document): boolean {
  const el = doc.activeElement;
  return el === null || el === doc.body || el === doc.documentElement || !el.isConnected;
}

/**
 * Where the focus goes back to: the open dialog, else the main content's roving widget (the grid's
 * active cell, the channel list), else its first tab stop, else the page's first tab stop.
 */
export function initialFocusTarget(doc: Document): HTMLElement | undefined {
  const dialogs = doc.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  const dialog = dialogs[dialogs.length - 1];
  if (dialog) return tabStopsIn(dialog)[0];
  const main = doc.querySelector('main') ?? doc.body;
  const widget = main.querySelector<HTMLElement>(
    '[role="grid"] [tabindex="0"], [role="listbox"][tabindex="0"]',
  );
  if (widget && isCandidate(widget)) return widget;
  return tabStopsIn(main)[0] ?? tabStopsIn(doc.body)[0];
}

/** Whether an arrow in `dir` on `el` belongs to the control itself (caret, slider, radio). */
function keptByControl(el: Element, dir: Direction): boolean {
  if (ownsArrows(el, dir)) return true;
  if (!isTextField(el)) return false;
  // ←/→ move the caret until it is at the field's start/end; ↑/↓ leave a single-line field.
  if (dir === 'left' || dir === 'right') return caretCanMove(el, dir);
  return el instanceof HTMLTextAreaElement;
}

/** Installs the D-pad listener; returns the uninstaller. */
export function installDpadNavigation({ back, doc = document }: DpadOptions): () => void {
  const root = doc.documentElement;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : doc.body;
    const dir = directionOf(event);
    const backAlias = isBackAlias(event) && !isTextField(target);
    const escape = event.key === 'Escape';
    if (dir || backAlias || event.key === 'Enter') root.setAttribute(INPUT_ATTRIBUTE, 'dpad');

    if (backAlias) {
      if (event.defaultPrevented) return;
      // Keep the browser from acting on it too (history back on Backspace in old engines), and
      // offer it to the page as Escape: the Escape branch below goes back if nothing uses it.
      event.preventDefault();
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }

    if (escape) {
      // Handled (a player, panel or dialog closed: `preventDefault`, or MUI's stopPropagation,
      // which keeps it from reaching the document at all), or a text field's own Escape.
      if (event.defaultPrevented || isTextField(target)) return;
      event.preventDefault();
      back();
      return;
    }

    if (!dir && event.key !== 'Enter') return;
    if (event.defaultPrevented) return;
    if (isLost(doc)) {
      const initial = initialFocusTarget(doc);
      if (initial) {
        event.preventDefault();
        initial.focus();
      }
      return;
    }
    if (!dir) {
      // OK on a native select opens its picker (desktop engines only open it with Space/Alt+↓).
      if (target instanceof HTMLSelectElement && typeof target.showPicker === 'function') {
        try {
          target.showPicker();
          event.preventDefault();
        } catch {
          // Not allowed here (e.g. no user activation): the engine's own Enter behaviour stays.
        }
      }
      return;
    }
    if (!(target instanceof HTMLElement) || keptByControl(target, dir)) return;
    const next = findNext(target, dir);
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const onPointerDown = () => root.removeAttribute(INPUT_ATTRIBUTE);

  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    root.removeAttribute(INPUT_ATTRIBUTE);
  };
}
