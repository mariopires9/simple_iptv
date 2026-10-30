// EPG-04 — guide grid: virtualised on both axes (2 000 channels × 48 h), "now" line, keyboard
// navigation between cells, details/play on Enter, programmes asked only for the visible rows.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import type { EpgService, ShortEpgProgramme } from './epg';
import { EpgGrid, GUIDE_HEADER_HEIGHT, GUIDE_ROW_HEIGHT } from './EpgGrid';
import { installGridMetrics } from './guide-test-utils';
import { guideWindow, xOf } from './guideLayout';
import { PageCache } from './pageCache';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 30, 12, 10);
const SPAN = guideWindow(NOW);
const CHANNEL_WIDTH = 200;
const TOTAL = 2_000;
/** Channel 3 has no guide. */
const NO_GUIDE = 3;

const channel = (i: number) =>
  ({ key: `s:live:${i}`, name: `Channel ${i}`, order: i, nameNorm: '', streamPath: '' }) as Channel;
const numberOf = (c: Channel) => Number(c.key.split(':')[2]);

/** Hourly programmes over the whole span: `C<n> P<k>`, P0 starting at the span start. */
function schedule(n: number): ShortEpgProgramme[] {
  if (n === NO_GUIDE) return [];
  const out: ShortEpgProgramme[] = [];
  for (let k = 0, start = SPAN.start; start < SPAN.end; k++, start += HOUR) {
    out.push({ title: `C${n} P${k}`, start, end: start + HOUR, description: `About ${k}` });
  }
  return out;
}

function instantEpg() {
  const entries = new Map<string, ShortEpgProgramme[]>();
  const listeners = new Set<() => void>();
  const loads: string[] = [];
  const service: EpgService = {
    peek: (c) => entries.get(c.key),
    load(c) {
      loads.push(c.key);
      const programmes = schedule(numberOf(c));
      entries.set(c.key, programmes);
      queueMicrotask(() => {
        for (const l of listeners) l();
      });
      return Promise.resolve(programmes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {},
  };
  return { service, loads, listeners };
}

function cacheOf(total: number) {
  const rows = Array.from({ length: total }, (_, i) => channel(i + 1));
  return new PageCache({
    total,
    load: (offset, limit) => Promise.resolve(rows.slice(offset, offset + limit)),
    locate: () => Promise.resolve(-1),
  });
}

function renderGrid(total = TOTAL) {
  const { service, loads, listeners } = instantEpg();
  const onPlay = vi.fn();
  const onOpen = vi.fn();
  const view = render(
    <ThemeModeProvider>
      <EpgGrid
        cache={cacheOf(total)}
        epg={service}
        span={SPAN}
        now={NOW}
        label="TV guide: All"
        channelWidth={CHANNEL_WIDTH}
        onPlay={onPlay}
        onOpen={onOpen}
      />
    </ThemeModeProvider>,
  );
  return { ...view, loads, listeners, onPlay, onOpen, grid: screen.getByRole('grid') };
}

const active = (grid: HTMLElement) =>
  document.getElementById(grid.getAttribute('aria-activedescendant') ?? '');

let restore: () => void;
beforeAll(() => {
  restore = installGridMetrics();
});
afterAll(() => restore());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('EpgGrid', () => {
  it('keeps 2 000 channels × 48 h virtualised on both axes and asks only the visible rows', async () => {
    const started = performance.now();
    const { grid, loads } = renderGrid();
    await screen.findByRole('gridcell', { name: /^C1 P2,/ });
    const firstRender = performance.now() - started;

    const rows = screen.getAllByRole('row').length - 1; // minus the time header
    const cells = screen.getAllByRole('gridcell').length;
    const visibleRows = Math.ceil((680 - GUIDE_HEADER_HEIGHT) / GUIDE_ROW_HEIGHT);
    expect(rows).toBeLessThanOrEqual(visibleRows + 2 * 4 + 1);
    // ~8 visible/overscanned half-hour slots → a handful of hourly programmes per row.
    expect(cells).toBeLessThan(rows * 8);
    expect(new Set(loads).size).toBeLessThanOrEqual(visibleRows + 1);
    // Far-future programmes are not in the DOM until the timeline reaches them.
    expect(screen.queryByRole('gridcell', { name: /^C1 P40,/ })).toBeNull();

    // Jump to the middle of the list and 40 hours ahead.
    const jumped = performance.now();
    act(() =>
      grid.scrollTo({ top: GUIDE_ROW_HEIGHT * 1000, left: xOf(SPAN.start + 40 * HOUR, SPAN) }),
    );
    await screen.findByRole('gridcell', { name: /^C1001 P40,/ }, { timeout: 2000 });
    const jump = performance.now() - jumped;
    expect(screen.getAllByRole('row').length - 1).toBeLessThanOrEqual(visibleRows + 2 * 4 + 2);

    // jsdom timings (no layout or paint): a regression guard, not a frame-rate measurement.
    expect(firstRender).toBeLessThan(3000);
    expect(jump).toBeLessThan(3000);
  });

  it('draws the "now" line at the current time', () => {
    renderGrid(10);
    const line = screen.getByTestId('epg-now-line');
    expect(line.style.left).toBe(`${CHANNEL_WIDTH + xOf(NOW, SPAN)}px`);
  });

  it('moves between programmes and channels with the arrows and opens details on Enter', async () => {
    const { grid, onOpen, onPlay } = renderGrid(10);
    await screen.findByRole('gridcell', { name: /^C2 P2,/ });
    grid.focus();
    // Starts on the programme on air in the first row.
    expect(active(grid)).toHaveAccessibleName(/^C1 P2, .*, on now$/);

    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(active(grid)).toHaveAccessibleName(/^C1 P3,/);
    expect(active(grid)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(active(grid)).toHaveAccessibleName(/^C2 P3,/);
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(active(grid)).toHaveAccessibleName(/^C2 P2,/);

    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[1]).toMatchObject({ title: 'C2 P2' });
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('lands on an empty stretch of a channel without guide and plays it on Enter', async () => {
    const { grid, onPlay, onOpen } = renderGrid(10);
    await screen.findByRole('gridcell', { name: /^C2 P2,/ });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await waitFor(() => expect(active(grid)).toHaveAccessibleName(/^Channel 3, .*no guide/));
    expect(screen.getAllByText('No guide information').length).toBeGreaterThan(0);
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ key: 's:live:3' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('plays a channel from its name and opens a programme on click', async () => {
    const { onPlay, onOpen } = renderGrid(10);
    fireEvent.click(await screen.findByRole('gridcell', { name: /^C4 P2,/ }));
    expect(onOpen.mock.calls[0]?.[1]).toMatchObject({ title: 'C4 P2' });
    fireEvent.click(screen.getByText('Channel 5'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ key: 's:live:5' }));
  });

  it('drops its EPG subscription on unmount', async () => {
    const { listeners, unmount } = renderGrid(10);
    await screen.findByRole('gridcell', { name: /^C1 P2,/ });
    expect(listeners.size).toBeGreaterThan(0);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
