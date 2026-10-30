// UX-05: D-pad / TV remote navigation — spatial focus, back key, focus never lost, channel keys.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installDpadNavigation, INPUT_ATTRIBUTE } from './installDpadNavigation';
import { channelKeyOf, directionOf, isBackAlias, TIZEN_BACK, WEBOS_BACK } from './keys';
import { pickInDirection, type Rect } from './spatial';

const box = (left: number, top: number, w = 100, h = 40): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('pickInDirection', () => {
  const row = [box(0, 0), box(120, 0), box(240, 0)];

  it('moves to the nearest box that way, and to nothing past the edge', () => {
    expect(pickInDirection(row[0]!, row, 'right')).toBe(1);
    expect(pickInDirection(row[1]!, row, 'right')).toBe(2);
    expect(pickInDirection(row[1]!, row, 'left')).toBe(0);
    expect(pickInDirection(row[0]!, row.slice(1), 'left')).toBeUndefined();
    expect(pickInDirection(row[0]!, row.slice(1), 'up')).toBeUndefined();
  });

  it('prefers a box in line over a nearer one offset sideways', () => {
    const from = box(0, 200);
    const aligned = box(300, 200);
    const offset = box(110, 0);
    expect(pickInDirection(from, [offset, aligned], 'right')).toBe(1);
  });

  it('falls back to centres for overlapping boxes', () => {
    const big = box(0, 0, 400, 300);
    const inside = box(300, 100, 40, 40);
    expect(pickInDirection(big, [inside], 'right')).toBe(0);
  });
});

describe('remote keys', () => {
  it('maps arrows (also legacy names and key codes)', () => {
    expect(directionOf({ key: 'ArrowLeft' })).toBe('left');
    expect(directionOf({ key: 'Down' })).toBe('down');
    expect(directionOf({ key: 'Unidentified', keyCode: 39 })).toBe('right');
    expect(directionOf({ key: 'Enter' })).toBeUndefined();
  });

  it('recognises the back keys of Android TV, Fire TV, Tizen and webOS', () => {
    for (const key of ['GoBack', 'BrowserBack', 'Backspace'])
      expect(isBackAlias({ key })).toBe(true);
    expect(isBackAlias({ key: 'Unidentified', keyCode: TIZEN_BACK })).toBe(true);
    expect(isBackAlias({ key: 'Unidentified', keyCode: WEBOS_BACK })).toBe(true);
    expect(isBackAlias({ key: 'Enter', keyCode: 13 })).toBe(false);
  });

  it('recognises the channel keys (names and Tizen key codes)', () => {
    expect(channelKeyOf({ key: 'ChannelUp' })).toBe('up');
    expect(channelKeyOf({ key: 'ChannelDown' })).toBe('down');
    expect(channelKeyOf({ key: 'Unidentified', keyCode: 427 })).toBe('up');
    expect(channelKeyOf({ key: 'Unidentified', keyCode: 428 })).toBe('down');
    expect(channelKeyOf({ key: 'ArrowUp' })).toBeUndefined();
  });
});

// jsdom has no layout: every element gets the rectangle of its `data-rect="left top w h"`.
function stubLayout() {
  const rectOf = (el: Element) => {
    const [l = 0, t = 0, w = 0, h = 0] = (el.getAttribute('data-rect') ?? '')
      .split(' ')
      .map(Number);
    return new DOMRect(l, t, w, h);
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const r = rectOf(this);
    const list = r.width > 0 || r.height > 0 ? [r] : [];
    return Object.assign(list, { item: (i: number) => list[i] ?? null }) as unknown as DOMRectList;
  });
}

type Child = Node | string;

/** A tiny DOM builder (tests may not use HTML-string sinks either, SEC-01). */
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

const link = (href: string, rect: string, text: string, extra: Record<string, string> = {}) =>
  h('a', { href, 'data-rect': rect, ...extra }, text);
const button = (rect: string, text: string, extra: Record<string, string> = {}) =>
  h('button', { type: 'button', 'data-rect': rect, ...extra }, text);

/**
 * A TV-like page: nav rail (Home, Movies = current) | categories (A, B = current) | grid cell, a
 * filter field above the grid, and a disabled button.
 */
function buildPage(): Node[] {
  return [
    h(
      'nav',
      { 'aria-label': 'Main' },
      link('#/', '0 100 80 60', 'Home'),
      link('#/movies', '0 160 80 60', 'Movies', { 'aria-current': 'page' }),
    ),
    h(
      'main',
      {},
      h('input', { type: 'search', 'aria-label': 'Filter', 'data-rect': '300 0 400 40' }),
      h(
        'nav',
        { 'aria-label': 'Categories' },
        link('#/a', '100 100 150 40', 'A'),
        link('#/b', '100 300 150 40', 'B', { 'aria-current': 'page' }),
      ),
      h(
        'div',
        { role: 'grid' },
        h(
          'div',
          { role: 'row' },
          link('#/m/1', '300 100 150 225', 'Movie 1', { tabindex: '0' }),
          link('#/m/2', '470 100 150 225', 'Movie 2', { tabindex: '-1' }),
        ),
      ),
    ),
    button('0 900 80 40', 'Disabled', { disabled: '' }),
  ];
}

const keydown = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('installDpadNavigation', () => {
  let back: Mock<() => void>;
  let uninstall: () => void;
  const el = (name: string) => {
    const found = Array.from(
      document.querySelectorAll<HTMLElement>('a, input, button, select'),
    ).find((e) => e.textContent === name || e.getAttribute('aria-label') === name);
    if (!found) throw new Error(name);
    return found;
  };
  const press = (key: string, init: KeyboardEventInit = {}) =>
    keydown(document.activeElement ?? document.body, { key, ...init });

  beforeEach(() => {
    stubLayout();
    document.body.replaceChildren(...buildPage());
    back = vi.fn<() => void>();
    uninstall = installDpadNavigation({ back });
  });
  afterEach(() => {
    uninstall();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('AC1: arrows move between regions; entering a navigation lands on its current item', () => {
    el('Movie 1').focus();
    expect(press('ArrowLeft').defaultPrevented).toBe(true);
    // The category "B" is current, though "A" is better in line with the movie's top edge.
    expect(document.activeElement).toBe(el('B'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(el('Movies'));
    press('ArrowUp'); // inside the same navigation: plain spatial focus
    expect(document.activeElement).toBe(el('Home'));
    press('ArrowRight'); // "A" is in line with Home, but "B" is the current category
    expect(document.activeElement).toBe(el('B'));
    press('ArrowRight');
    expect(document.activeElement).toBe(el('Movie 1'));
    press('ArrowUp');
    expect(document.activeElement).toBe(el('Filter'));
    // ←/→ belong to the caret in a text field until it reaches the start/end; ↓ leaves it.
    const filter = el('Filter') as HTMLInputElement;
    filter.value = 'ab';
    filter.setSelectionRange(1, 1);
    expect(press('ArrowLeft').defaultPrevented).toBe(false);
    expect(press('ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(filter);
    filter.setSelectionRange(0, 0);
    press('ArrowLeft'); // at the start: leaves to the category nav (its current item)
    expect(document.activeElement).toBe(el('B'));
    filter.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(el('Movie 1'));
  });

  it('AC1: an arrow a widget handled (preventDefault) is left alone; roving cells are skipped', () => {
    const cell = el('Movie 1');
    cell.addEventListener('keydown', (e) => e.preventDefault());
    cell.focus();
    press('ArrowLeft');
    expect(document.activeElement).toBe(cell);
    // Movie 2 (tabindex -1) is the grid's own business: → from Movie 1 finds nothing else.
    cell.replaceWith(cell.cloneNode(true));
    el('Movie 1').focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(el('Movie 1'));
  });

  it('AC1: a dialog or a D-pad scope keeps the focus inside it; ↑/↓ leave a slider', () => {
    document.body.append(
      h(
        'div',
        { 'data-dpad-scope': '' },
        button('300 500 50 50', 'Play'),
        button('400 500 50 50', 'Mute'),
        h('input', { type: 'range', 'aria-label': 'Volume', 'data-rect': '300 600 150 20' }),
      ),
    );
    el('Play').focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(el('Mute'));
    press('ArrowUp'); // the grid is above, but outside the scope
    expect(document.activeElement).toBe(el('Mute'));
    press('ArrowDown');
    expect(document.activeElement).toBe(el('Volume'));
    expect(press('ArrowLeft').defaultPrevented).toBe(false); // the slider's own key
    expect(document.activeElement).toBe(el('Volume'));
    press('ArrowUp');
    expect(document.activeElement).toBe(el('Play'));
  });

  it('AC1: a move stays in its region when it can (↓ in <main> skips the rail beside it)', () => {
    const main = document.querySelector('main') as HTMLElement;
    main.append(link('#/back', '300 400 100 30', 'Back'), button('700 700 100 40', 'Play'));
    document.querySelector('nav')?.append(link('#/series', '0 440 80 60', 'Series'));
    el('Back').focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(el('Play'));
  });

  it('AC1: arrows leave a native select; OK opens its picker', () => {
    const main = document.querySelector('main') as HTMLElement;
    main.append(
      h('select', { 'aria-label': 'Sort', 'data-rect': '700 0 100 40' }, h('option', {}, 'A')),
    );
    const select = el('Sort') as HTMLSelectElement;
    const showPicker = vi.fn();
    Object.assign(select, { showPicker });
    select.focus();
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(showPicker).toHaveBeenCalledTimes(1);
    press('ArrowLeft');
    expect(document.activeElement).toBe(el('Filter'));
  });

  it.each([
    ['GoBack', undefined],
    ['BrowserBack', undefined],
    ['Backspace', undefined],
    ['Unidentified', TIZEN_BACK],
    ['Unidentified', WEBOS_BACK],
    ['Escape', undefined],
  ])('AC2: back key %s/%s closes what is open first, then goes back', (key, keyCode) => {
    const player = h('div', {}, button('0 0 10 10', 'Close'));
    document.body.append(player);
    const close = vi.fn((e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      player.remove();
    });
    player.addEventListener('keydown', close);
    el('Close').focus();
    expect(press(key, { keyCode }).defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    // Nothing left to close: the next back key goes back in the history, once.
    el('Movie 1').focus();
    press(key, { keyCode });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('AC2: a dialog that stops Escape (MUI) closes without going back', () => {
    const dialog = h('div', {}, button('0 0 10 10', 'OK'));
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.stopPropagation();
    });
    document.body.append(dialog);
    el('OK').focus();
    press('GoBack');
    press('Escape');
    expect(back).not.toHaveBeenCalled();
  });

  it('AC2: Backspace and Escape in a text field stay with the field', () => {
    el('Filter').focus();
    expect(press('Backspace').defaultPrevented).toBe(false);
    press('Escape');
    expect(back).not.toHaveBeenCalled();
  });

  it('AC3: with the focus lost, a D-pad key brings it back to the main content', () => {
    el('Home').focus();
    el('Home').remove(); // e.g. the focused screen went away
    expect(document.activeElement).toBe(document.body);
    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el('Movie 1')); // the grid's tab stop
    (document.activeElement as HTMLElement).blur();
    document.querySelector('[role="grid"]')?.remove();
    press('Enter');
    expect(document.activeElement).toBe(el('Filter')); // the first tab stop of <main>
  });

  it('turns the large focus ring on with the D-pad and off with a pointer', () => {
    const root = document.documentElement;
    el('Movie 1').focus();
    press('ArrowLeft');
    expect(root.getAttribute(INPUT_ATTRIBUTE)).toBe('dpad');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.hasAttribute(INPUT_ATTRIBUTE)).toBe(false);
  });
});
