// Spatial focus (UX-05): which focusable element an arrow key moves to. The pure part
// (`pickInDirection`) works on rectangles; `findNext` reads them from the DOM.
//
// Only tab stops are candidates (`tabIndex >= 0`): a roving-focus widget (the poster grid, the
// channel listbox) exposes a single one, so arrows inside it stay the widget's job and spatial
// focus only moves between regions — nav rail ↔ categories ↔ grid/list ↔ player controls.
import type { Direction } from './keys';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Marks a container that keeps spatial focus inside it (e.g. the player). Back leaves it. */
export const DPAD_SCOPE_ATTRIBUTE = 'data-dpad-scope';

/** Edges closer than this count as touching (sub-pixel layout). */
const EPSILON = 1;
/** Weight of the sideways offset against the distance along the arrow. */
const ORTHOGONAL_WEIGHT = 2;

/** Gap between the ranges [a1, a2] and [b1, b2] (0 when they overlap). */
function gap(a1: number, a2: number, b1: number, b2: number): number {
  if (b2 < a1) return a1 - b2;
  if (b1 > a2) return b1 - a2;
  return 0;
}

/** Distance along the arrow from `from` to `to`, or undefined if `to` is not that way. */
function along(from: Rect, to: Rect, dir: Direction): number | undefined {
  let d: number;
  switch (dir) {
    case 'right':
      d = to.left - from.right;
      break;
    case 'left':
      d = from.left - to.right;
      break;
    case 'down':
      d = to.top - from.bottom;
      break;
    case 'up':
      d = from.top - to.bottom;
      break;
  }
  return d >= -EPSILON ? Math.max(0, d) : undefined;
}

/** Centre-based fallback for overlapping boxes (a control on top of a larger one). */
function alongCentre(from: Rect, to: Rect, dir: Direction): number | undefined {
  const overlap =
    to.left < from.right && to.right > from.left && to.top < from.bottom && to.bottom > from.top;
  if (!overlap) return undefined;
  const fx = (from.left + from.right) / 2;
  const fy = (from.top + from.bottom) / 2;
  const tx = (to.left + to.right) / 2;
  const ty = (to.top + to.bottom) / 2;
  const d = { right: tx - fx, left: fx - tx, down: ty - fy, up: fy - ty }[dir];
  return d > EPSILON ? d : undefined;
}

function sideways(from: Rect, to: Rect, dir: Direction): number {
  return dir === 'left' || dir === 'right'
    ? gap(from.top, from.bottom, to.top, to.bottom)
    : gap(from.left, from.right, to.left, to.right);
}

function centreOffset(from: Rect, to: Rect, dir: Direction): number {
  return dir === 'left' || dir === 'right'
    ? Math.abs((from.top + from.bottom) / 2 - (to.top + to.bottom) / 2)
    : Math.abs((from.left + from.right) / 2 - (to.left + to.right) / 2);
}

/**
 * Index of the best candidate in `dir` from `from`: the nearest box beyond the current one's edge,
 * preferring boxes in line with it (e.g. → from a list row lands on the control beside it, not on
 * one further up). When nothing lies wholly beyond the edge, boxes overlapping the current one
 * whose centre lies that way are used.
 * Undefined when nothing lies that way.
 */
export function pickInDirection(
  from: Rect,
  candidates: readonly Rect[],
  dir: Direction,
): number | undefined {
  const best = (distance: (to: Rect) => number | undefined) => {
    let index: number | undefined;
    let score = Infinity;
    let tie = Infinity;
    candidates.forEach((to, i) => {
      const d = distance(to);
      if (d === undefined) return;
      const s = d + ORTHOGONAL_WEIGHT * sideways(from, to, dir);
      const c = centreOffset(from, to, dir);
      if (s < score || (s === score && c < tie)) {
        index = i;
        score = s;
        tie = c;
      }
    });
    return index;
  };
  return best((to) => along(from, to, dir)) ?? best((to) => alongCentre(from, to, dir));
}

const FOCUSABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/** Whether `el` can take the focus from an arrow key: a visible, enabled tab stop. */
export function isCandidate(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if ((el as HTMLButtonElement).disabled === true) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** The tab stops inside `root`, in document order. */
export function tabStopsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isCandidate);
}

/** Where spatial focus may go from `el`: its dialog or D-pad scope, else the whole page. */
export function scopeOf(el: Element): ParentNode {
  return (
    el.closest(
      `[role="dialog"], [role="alertdialog"], [aria-modal="true"], [${DPAD_SCOPE_ATTRIBUTE}]`,
    ) ?? el.ownerDocument
  );
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/**
 * Entering a navigation landmark from outside lands on its current item (the selected category or
 * destination), not on whichever link happens to be nearest.
 */
function preferCurrent(from: HTMLElement, target: HTMLElement): HTMLElement {
  const nav = target.closest('nav');
  if (!nav || nav.contains(from)) return target;
  const current = nav.querySelector<HTMLElement>('[aria-current="page"], [aria-current="true"]');
  return current && isCandidate(current) ? current : target;
}

/** Regions searched first, innermost out: a move stays in its region when it can. */
const REGIONS = 'nav, main, header, aside, footer, [role="region"], [role="toolbar"]';

/**
 * The element an arrow in `dir` moves to from `from`, if any. The nearest tab stop that way inside
 * `from`'s own region wins (↓ from "Back to movies" goes to Play, not to the nav rail beside the
 * page); only when the region has nothing that way does the search widen, up to the scope.
 */
export function findNext(from: HTMLElement, dir: Direction): HTMLElement | undefined {
  const origin = rectOf(from);
  const scope = scopeOf(from);
  const all = tabStopsIn(scope).filter(
    (el) => el !== from && !el.contains(from) && !from.contains(el),
  );
  const rects = new Map(all.map((el) => [el, rectOf(el)]));
  let region: Element | null = from.parentElement?.closest(REGIONS) ?? null;
  for (;;) {
    const inside = region && scope.contains(region) && region !== scope ? region : undefined;
    const candidates = inside ? all.filter((el) => inside.contains(el)) : all;
    const index = pickInDirection(
      origin,
      candidates.map((el) => rects.get(el) as Rect),
      dir,
    );
    const target = index === undefined ? undefined : candidates[index];
    if (target) return preferCurrent(from, target);
    if (!inside) return undefined;
    region = inside.parentElement?.closest(REGIONS) ?? null;
  }
}
