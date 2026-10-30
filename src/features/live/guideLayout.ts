// Time geometry and keyboard moves of the guide grid (EPG-04). Pure functions: the grid maps
// times to pixels along one horizontal axis, and the keyboard moves an "anchor" time along a row
// (programme to programme, or 30-minute steps across stretches without guide information).
import type { ShortEpgProgramme } from './epg';

export const MINUTE_MS = 60_000;
/** Header ticks and the step across empty stretches. */
export const SLOT_MS = 30 * MINUTE_MS;
export const PX_PER_MINUTE = 4;
export const SLOT_PX = (SLOT_MS / MINUTE_MS) * PX_PER_MINUTE;
/** Hours of the span shown before the current half hour. */
export const HOURS_BEFORE = 2;
/** Width of the whole span. */
export const WINDOW_HOURS = 48;

export interface GuideWindow {
  /** First instant on the timeline (a slot boundary). */
  start: number;
  /** Instant right after the timeline (exclusive). */
  end: number;
}

/** Start of the 30-minute slot containing `time`. */
export function slotStart(time: number): number {
  return Math.floor(time / SLOT_MS) * SLOT_MS;
}

/** The span of a grid opened at `now`: two hours back, 48 hours wide. */
export function guideWindow(now: number): GuideWindow {
  const start = slotStart(now) - HOURS_BEFORE * 60 * MINUTE_MS;
  return { start, end: start + WINDOW_HOURS * 60 * MINUTE_MS };
}

export function slotCount(span: GuideWindow): number {
  return Math.ceil((span.end - span.start) / SLOT_MS);
}

/** Horizontal position of `time` on the timeline (0 = span start). */
export function xOf(time: number, span: GuideWindow): number {
  return ((time - span.start) / MINUTE_MS) * PX_PER_MINUTE;
}

/** Instant at timeline position `x`. */
export function timeAt(x: number, span: GuideWindow): number {
  return span.start + (x / PX_PER_MINUTE) * MINUTE_MS;
}

/** Programmes overlapping `[from, to)`, in start order (input from untrusted listings). */
export function overlapping(
  programmes: readonly ShortEpgProgramme[] | undefined,
  from: number,
  to: number,
): ShortEpgProgramme[] {
  if (!programmes) return [];
  return programmes
    .filter((p) => p.end > p.start && p.start < to && p.end > from)
    .sort((a, b) => a.start - b.start);
}

/** The programme airing at `time`, if any. */
export function programmeAt(
  programmes: readonly ShortEpgProgramme[],
  time: number,
): ShortEpgProgramme | undefined {
  return programmes.find((p) => p.start <= time && time < p.end);
}

/** A cell of a row: a programme, or a stretch without guide information. */
export type GuideCell =
  | { kind: 'programme'; programme: ShortEpgProgramme; start: number; end: number }
  | { kind: 'gap'; start: number; end: number };

/**
 * The cell at `time` in a row (clipped to the span). A gap spans its 30-minute slot, cut by
 * the programmes around it.
 */
export function cellAt(
  programmes: readonly ShortEpgProgramme[],
  time: number,
  span: GuideWindow,
): GuideCell {
  const programme = programmeAt(programmes, time);
  if (programme) {
    return {
      kind: 'programme',
      programme,
      start: Math.max(programme.start, span.start),
      end: Math.min(programme.end, span.end),
    };
  }
  const slot = slotStart(time);
  let start = Math.max(slot, span.start);
  let end = Math.min(slot + SLOT_MS, span.end);
  for (const p of programmes) {
    if (p.end <= time) start = Math.max(start, p.end);
    if (p.start > time) end = Math.min(end, p.start);
  }
  return { kind: 'gap', start, end };
}

/**
 * Anchor time after moving one cell left (`-1`) or right (`+1`) from `time`: the start of the
 * neighbouring cell, or `time` itself at either end of the span.
 */
export function moveAlongRow(
  programmes: readonly ShortEpgProgramme[],
  time: number,
  direction: -1 | 1,
  span: GuideWindow,
): number {
  const cell = cellAt(programmes, time, span);
  if (direction > 0) return cell.end >= span.end ? time : cell.end;
  if (cell.start <= span.start) return time;
  return cellAt(programmes, cell.start - 1, span).start;
}

/** Clamps `time` into the span. */
export function clampToWindow(time: number, span: GuideWindow): number {
  return Math.max(span.start, Math.min(span.end - 1, time));
}
