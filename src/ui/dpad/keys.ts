// Remote-control key mapping (UX-05). TV browsers deliver the D-pad as arrow keys and OK as Enter,
// but "back" and the channel keys differ per platform:
//   - Back: `Escape` (desktop), `Backspace` (many remotes), `GoBack`/`BrowserBack` (Android TV,
//     Fire TV), keyCode 10009 (Samsung Tizen) and 461 (LG webOS).
//   - Channel ±: `ChannelUp`/`ChannelDown` (Android TV, Fire TV), keyCodes 427/428 (Tizen); LG
//     remotes send `PageUp`/`PageDown`. Everywhere they act like PageUp/PageDown (and, in the
//     player, like ↑/↓: CH+ goes up the channel list), so every remote behaves the same.

export type Direction = 'up' | 'down' | 'left' | 'right';

/** The parts of a keyboard event the mapping reads (a DOM or a React event). */
export interface KeyLike {
  key: string;
  keyCode?: number | undefined;
}

const DIRECTION_KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // Legacy names (older TV engines).
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
};

const DIRECTION_CODES: Readonly<Record<number, Direction>> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
};

/** Tizen and webOS back keys (no standard `key` value). */
export const TIZEN_BACK = 10009;
export const WEBOS_BACK = 461;
/** Tizen channel keys. */
export const TIZEN_CHANNEL_UP = 427;
export const TIZEN_CHANNEL_DOWN = 428;

/** The D-pad direction of a key, if it is one. */
export function directionOf(event: KeyLike): Direction | undefined {
  const named = DIRECTION_KEYS[event.key];
  if (named) return named;
  if (event.key === 'Unidentified' && event.keyCode !== undefined) {
    return DIRECTION_CODES[event.keyCode];
  }
  return undefined;
}

/**
 * A remote "back" key other than Escape (which components already handle as "close"). Backspace
 * counts only outside text fields: the caller checks that.
 */
export function isBackAlias(event: KeyLike): boolean {
  return (
    event.key === 'GoBack' ||
    event.key === 'BrowserBack' ||
    event.key === 'Backspace' ||
    event.keyCode === TIZEN_BACK ||
    event.keyCode === WEBOS_BACK
  );
}

/** A channel key, as the direction it moves in the channel list (`up` = CH+ = PageUp). */
export function channelKeyOf(event: KeyLike): 'up' | 'down' | undefined {
  if (event.key === 'ChannelUp' || event.keyCode === TIZEN_CHANNEL_UP) return 'up';
  if (event.key === 'ChannelDown' || event.keyCode === TIZEN_CHANNEL_DOWN) return 'down';
  return undefined;
}

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

/** A field where the caret moves with ←/→ and Backspace deletes text. */
export function isTextField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // `isContentEditable` is missing in some environments (jsdom).
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/** Horizontal sliders (seek, volume): ←/→ change the value, ↑/↓ are free to leave them. */
function isHorizontalSlider(el: Element): boolean {
  const slider =
    (el instanceof HTMLInputElement && el.type === 'range') || el.matches('[role="slider"]');
  return slider && el.getAttribute('aria-orientation') !== 'vertical';
}

/**
 * Controls that use the arrow key in `dir` themselves (radio groups, spin buttons; a horizontal
 * slider uses ←/→ only). A closed native select does not: with a remote, OK opens its picker and
 * the arrows move on, so it never holds the focus.
 */
export function ownsArrows(el: Element, dir: Direction): boolean {
  if ((dir === 'up' || dir === 'down') && isHorizontalSlider(el)) return false;
  if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'radio')) return true;
  return el.matches('[role="slider"], [role="radio"], [role="spinbutton"]');
}

/**
 * Whether ←/→ still move the caret of a text field: not at its start (←) or end (→). Fields
 * without a caret position (e.g. `type="email"` in some engines) keep both.
 */
export function caretCanMove(el: Element, dir: 'left' | 'right'): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return true;
  let start: number | null;
  let end: number | null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return true;
  }
  if (start === null || end === null) return true;
  if (start !== end) return true;
  return dir === 'left' ? start > 0 : end < el.value.length;
}
