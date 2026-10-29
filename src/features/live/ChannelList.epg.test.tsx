// EPG-01 review fixes on the channel list: page arrivals add only the newly loaded rows (nothing
// in flight is aborted or asked twice), a range change cancels only the rows that left it, and
// the "now" line follows programme boundaries (one timer), asking again once the cache runs out.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@/core/db';
import { CHANNEL_ROW_HEIGHT } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { ChannelList } from './ChannelList';
import type { EpgService, ShortEpgProgramme } from './epg';
import { PageCache } from './pageCache';
import { installScrollMetrics } from './test-utils';

const channel = (i: number) =>
  ({ key: `s:live:${i}`, name: `Channel ${i}`, order: i, nameNorm: '', streamPath: '' }) as Channel;
const indexOf = (key: string) => Number(key.split(':')[2]) - 1;

/** A pager whose pages arrive only when released. */
function heldCache(total: number) {
  const rows = Array.from({ length: total }, (_, i) => channel(i + 1));
  const pending = new Map<number, () => void>();
  const cache = new PageCache({
    total,
    load: (offset, limit) =>
      new Promise<Channel[]>((resolve) =>
        pending.set(offset, () => resolve(rows.slice(offset, offset + limit))),
      ),
    locate: () => Promise.resolve(-1),
  });
  return {
    cache,
    release: (offset: number) =>
      act(() => {
        pending.get(offset)?.();
        pending.delete(offset);
      }),
  };
}

interface Load {
  key: string;
  signal: AbortSignal | undefined;
  answer: (programmes: ShortEpgProgramme[]) => void;
}

/** EPG service double: records every load; answers only when told to. */
function fakeEpg() {
  const entries = new Map<string, ShortEpgProgramme[]>();
  const listeners = new Set<() => void>();
  const loads: Load[] = [];
  const service: EpgService = {
    peek(c) {
      const programmes = entries.get(c.key);
      if (!programmes) return undefined;
      const now = Date.now();
      return programmes.length === 0 || programmes.some((p) => p.end > now)
        ? programmes
        : undefined;
    },
    load(c, { signal } = {}) {
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        loads.push({
          key: c.key,
          signal,
          answer: (programmes) => {
            entries.set(c.key, programmes);
            resolve(programmes);
            for (const l of listeners) l();
          },
        });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {},
  };
  return { service, loads };
}

let restore: () => void;
beforeEach(() => {
  restore = installScrollMetrics({ scrollHeight: true });
});
afterEach(() => restore());

function show(cache: PageCache, epg: EpgService) {
  render(
    <ThemeModeProvider>
      <ChannelList
        cache={cache}
        label="Channels"
        favorites={new Set()}
        onPlay={() => {}}
        onToggleFavorite={() => {}}
        epg={epg}
      />
    </ThemeModeProvider>,
  );
  return screen.getByRole('listbox');
}

const rowsOf = (loads: Load[]) => loads.map((l) => indexOf(l.key)).sort((a, b) => a - b);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('ChannelList — EPG of the visible rows', () => {
  it('a page arriving inside the range adds its rows; nothing in flight is aborted or re-asked', async () => {
    const { cache, release } = heldCache(400);
    const { service, loads } = fakeEpg();
    const list = show(cache, service);
    // Viewport rows 195–204 straddle pages 0 (0–199) and 1 (200–399).
    act(() => list.scrollTo({ top: 195 * CHANNEL_ROW_HEIGHT }));
    release(0);
    await waitFor(() => expect(rowsOf(loads)).toEqual(range(195, 199)));
    release(200);
    await waitFor(() => expect(rowsOf(loads)).toEqual(range(195, 204)));
    expect(loads.filter((l) => l.signal?.aborted)).toEqual([]);
  });

  it('a new range cancels only the rows that left it, after the scroll settles', async () => {
    const { cache, release } = heldCache(400);
    const { service, loads } = fakeEpg();
    const list = show(cache, service);
    release(0);
    await waitFor(() => expect(rowsOf(loads)).toEqual(range(0, 9)));
    act(() => list.scrollTo({ top: 5 * CHANNEL_ROW_HEIGHT }));
    await waitFor(() => expect(rowsOf(loads)).toEqual(range(0, 14)));
    const aborted = loads.filter((l) => l.signal?.aborted).map((l) => indexOf(l.key));
    expect(aborted.sort((a, b) => a - b)).toEqual(range(0, 4));
    // Rows 5–9 stayed in the range: their requests were neither aborted nor repeated.
    expect(loads.filter((l) => indexOf(l.key) >= 5 && l.signal?.aborted)).toEqual([]);
  });

  it('shows the next programme at the boundary and asks again once the cache ran out', async () => {
    const { cache, release } = heldCache(20);
    const { service, loads } = fakeEpg();
    const list = show(cache, service);
    release(0);
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    const now = Date.now();
    const first = loads.find((l) => l.key === 's:live:1') as Load;
    act(() =>
      first.answer([
        { title: 'First show', start: now - 1_000, end: now + 400 },
        { title: 'Second show', start: now + 400, end: now + 800 },
      ]),
    );
    const row = () =>
      within(list)
        .getAllByRole('option')
        .find((o) => o.getAttribute('aria-posinset') === '1') as HTMLElement;
    await waitFor(() => expect(within(row()).getByTestId('row-now')).toHaveTextContent('First'));
    await waitFor(() => expect(within(row()).getByTestId('row-now')).toHaveTextContent('Second'), {
      timeout: 2_000,
    });
    // Both programmes over: the row is asked for again.
    await waitFor(() => expect(loads.filter((l) => l.key === 's:live:1')).toHaveLength(2), {
      timeout: 2_000,
    });
    expect(within(row()).queryByTestId('row-now')).toBeNull();
  });
});
