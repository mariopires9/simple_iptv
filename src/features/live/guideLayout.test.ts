// EPG-04 — guide grid geometry and keyboard moves along a row.
import { describe, expect, it } from 'vitest';
import type { ShortEpgProgramme } from './epg';
import {
  SLOT_MS,
  cellAt,
  guideWindow,
  moveAlongRow,
  overlapping,
  slotCount,
  xOf,
} from './guideLayout';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 30, 12, 10);
const SPAN = guideWindow(NOW);
const at = (minutes: number) => SPAN.start + minutes * MIN;
const p = (title: string, from: number, to: number): ShortEpgProgramme => ({
  title,
  start: at(from),
  end: at(to),
});

describe('guide layout', () => {
  it('opens two hours before the current half hour, 48 hours wide, in 30-minute slots', () => {
    expect(SPAN.start).toBe(Date.UTC(2026, 9, 30, 10, 0));
    expect(SPAN.end - SPAN.start).toBe(48 * 60 * MIN);
    expect(slotCount(SPAN)).toBe(96);
    expect(xOf(SPAN.start + SLOT_MS, SPAN)).toBe(120);
  });

  it('keeps only valid programmes overlapping the range, in start order', () => {
    const list = [p('b', 60, 90), p('a', -30, 10), p('bad', 50, 50), p('out', 3000, 3100)];
    expect(overlapping(list, SPAN.start, SPAN.end).map((x) => x.title)).toEqual(['a', 'b']);
  });

  it('moves programme to programme, and in 30-minute steps across gaps', () => {
    // [0,40) programme, gap [40,60), [60,75) programme, then nothing.
    const list = [p('A', 0, 40), p('B', 60, 75)];
    expect(cellAt(list, at(45), SPAN)).toEqual({ kind: 'gap', start: at(40), end: at(60) });
    let time = at(10);
    time = moveAlongRow(list, time, 1, SPAN);
    expect(time).toBe(at(40));
    time = moveAlongRow(list, time, 1, SPAN);
    expect(cellAt(list, time, SPAN)).toMatchObject({ kind: 'programme', start: at(60) });
    time = moveAlongRow(list, time, 1, SPAN);
    // Gap up to the end of its slot.
    expect(cellAt(list, time, SPAN)).toEqual({ kind: 'gap', start: at(75), end: at(90) });
    time = moveAlongRow(list, time, -1, SPAN);
    expect(time).toBe(at(60));
    time = moveAlongRow(list, time, -1, SPAN);
    expect(time).toBe(at(40));
    time = moveAlongRow(list, time, -1, SPAN);
    expect(time).toBe(at(0));
    // The window's edges stop the move.
    expect(moveAlongRow(list, time, -1, SPAN)).toBe(at(0));
    expect(moveAlongRow([], SPAN.end - 1, 1, SPAN)).toBe(SPAN.end - 1);
  });

  it('clips a programme that started before the window', () => {
    expect(cellAt([p('Long', -90, 30)], at(5), SPAN)).toMatchObject({
      kind: 'programme',
      start: SPAN.start,
      end: at(30),
    });
  });
});
