// LIV-03: the Live screen remembers the category, the selected row and the scroll offset per
// source, restores them on the next visit (bare `/live`), never hijacks explicit deep links, and
// "Play last channel on open" (off by default) reopens the last channel. Muted autoplay when the
// browser blocks sound is PlayerView's job (src/player/ui/PlayerView.test.tsx, "NotAllowedError →
// retries muted and offers Unmute").
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemKey, settingsRepo, wipeAll } from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { CHANNEL_ROW_HEIGHT } from '@/ui/state';
import {
  clearLiveState,
  loadLiveStartup,
  saveLastChannel,
  saveLiveView,
  setPlayLastChannelOnOpen,
} from './liveState';
import {
  EMPTY_SOURCE_ID,
  SOURCE_ID,
  installScrollMetrics,
  renderLive,
  seedCatalog,
} from './test-utils';

const key = (n: number) => itemKey(SOURCE_ID, 'live', String(n));

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeAll(async () => {
  await seedCatalog();
}, 60_000);
afterAll(async () => {
  await wipeAll();
});
beforeEach(() => {
  restoreScroll = installScrollMetrics({ scrollHeight: true });
  clearLogBuffer();
});
afterEach(async () => {
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  await settingsRepo.set('activeSourceId', SOURCE_ID);
  await clearLiveState();
});

function show(path: string) {
  const view = renderLive(path);
  media = view.media;
  return view;
}

const listbox = (name: string | RegExp = /^Channels in/) =>
  screen.findByRole('listbox', { name }, { timeout: 5000 });
const activeOption = (list: HTMLElement) => {
  const id = list.getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
};
const view = (categoryId: string, extra: Record<string, unknown> = {}) => ({
  categoryId,
  selectedIndex: 0,
  scrollTop: 0,
  savedAt: Date.now(),
  ...extra,
});

describe('LIV-03 AC1 — reopening restores category, selection and scroll', () => {
  it('Live › Mega › channel X: the next visit to /live is back there, X selected and visible', async () => {
    const first = show('/live/category/30');
    const list = await listbox('Channels in Mega');
    act(() => list.focus());
    // 15 rows down: the list scrolls to keep the selection visible.
    await userEvent.keyboard('{ArrowDown>15/}');
    const selected = 'Channel 26';
    await waitFor(() => expect(activeOption(list)).toHaveTextContent(selected));
    const scrollTop = list.scrollTop;
    expect(scrollTop).toBeGreaterThan(0);
    // Leaving the screen flushes the debounced save.
    first.unmount();
    media?.restore();
    await waitFor(async () =>
      expect((await loadLiveStartup(SOURCE_ID)).view).toMatchObject({
        categoryId: '30',
        selectedIndex: 15,
        selectedKey: key(26),
        scrollTop,
      }),
    );

    const { router } = show('/live');
    const restored = await listbox('Channels in Mega');
    expect(router.state.location.pathname).toBe('/live/category/30');
    // Replaced, not pushed: Back does not return to the bare /live.
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(activeOption(restored)).toHaveTextContent(selected));
    expect(restored.scrollTop).toBe(scrollTop);
    // Not played: "Play last channel on open" is off by default.
    expect(router.state.location.search).toBe('');
    expect(screen.queryByTestId('live-player')).toBeNull();
  });

  it('saves the scroll offset while scrolling (debounced) and restores it on a reload', async () => {
    const first = show('/live/category/30');
    const list = await listbox('Channels in Mega');
    act(() => list.scrollTo({ top: 300 * CHANNEL_ROW_HEIGHT }));
    await waitFor(
      async () =>
        expect((await loadLiveStartup(SOURCE_ID)).view?.scrollTop).toBe(300 * CHANNEL_ROW_HEIGHT),
      { timeout: 3000 },
    );
    first.unmount();
    media?.restore();

    // A reload keeps the URL (deep link to the same category): the offset comes back.
    show('/live/category/30');
    const restored = await listbox('Channels in Mega');
    await waitFor(() => expect(restored.scrollTop).toBe(300 * CHANNEL_ROW_HEIGHT));
  });

  it('the restore is one-shot: a remount (filter cleared) starts where the list is now', async () => {
    await saveLiveView(SOURCE_ID, view('30', { scrollTop: 300 * CHANNEL_ROW_HEIGHT }));
    show('/live');
    const list = await listbox('Channels in Mega');
    await waitFor(() => expect(list.scrollTop).toBe(300 * CHANNEL_ROW_HEIGHT));
    act(() => list.scrollTo({ top: 100 * CHANNEL_ROW_HEIGHT }));
    // Filtering and clearing the filter remounts the list.
    const field = screen.getByRole('searchbox', { name: 'Filter channels' });
    await userEvent.type(field, 'channel 11');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/channels? match/), {
      timeout: 30_000,
    });
    await userEvent.keyboard('{Escape}');
    const back = await listbox('Channels in Mega');
    await waitFor(() => expect(back.scrollTop).toBe(100 * CHANNEL_ROW_HEIGHT));
    // …and the mount never wrote the stale restored offset back.
    await waitFor(async () =>
      expect((await loadLiveStartup(SOURCE_ID)).view?.scrollTop).toBe(100 * CHANNEL_ROW_HEIGHT),
    );
  }, 60_000);

  it('"All" saved: bare /live stays as it is and restores the offset', async () => {
    await saveLiveView(SOURCE_ID, view('~all', { scrollTop: 50 * CHANNEL_ROW_HEIGHT }));
    const { router } = show('/live');
    const list = await listbox('Channels in All');
    expect(router.state.location.pathname).toBe('/live');
    await waitFor(() => expect(list.scrollTop).toBe(50 * CHANNEL_ROW_HEIGHT));
  });

  it('a channel moved by a sync is located again by key and centred', async () => {
    // Sports (20) holds channels 6–10; the saved index is stale (0) but the key is channel 8.
    await saveLiveView(SOURCE_ID, view('20', { selectedKey: key(8), selectedIndex: 0 }));
    show('/live');
    const list = await listbox('Channels in Sports');
    await waitFor(() => expect(activeOption(list)).toHaveTextContent('Channel 8'));
  });

  it('the Live tab (bare /live) while on Live goes back to the latest state, not a stale one', async () => {
    await saveLiveView(SOURCE_ID, view('30', { selectedIndex: 50 }));
    const { router } = show('/live/category/10');
    const list = await listbox('Channels in News');
    act(() => list.focus());
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => expect(activeOption(list)).toHaveTextContent('Channel 3'));
    await act(() => router.navigate('/live'));
    const back = await listbox('Channels in News');
    await waitFor(() => expect(router.state.location.pathname).toBe('/live/category/10'));
    await waitFor(() => expect(activeOption(back)).toHaveTextContent('Channel 3'));
  });

  it('never redirects an explicit deep link to another category', async () => {
    await saveLiveView(SOURCE_ID, view('30', { selectedIndex: 50, scrollTop: 3200 }));
    const { router } = show('/live/category/10');
    const list = await listbox('Channels in News');
    expect(router.state.location.pathname).toBe('/live/category/10');
    await waitFor(() => expect(activeOption(list)).toHaveTextContent('Channel 1'));
  });
});

describe('LIV-03 AC2 — "Play last channel on open"', () => {
  it('off by default: the last channel is remembered but not played', async () => {
    await saveLiveView(SOURCE_ID, view('10'));
    await saveLastChannel(key(3));
    const { router } = show('/live');
    await listbox('Channels in News');
    expect(router.state.location.pathname).toBe('/live/category/10');
    expect(router.state.location.search).toBe('');
    expect(screen.queryByTestId('live-player')).toBeNull();
  });

  it('on: opening Live plays the last channel (in its saved category)', async () => {
    await saveLiveView(SOURCE_ID, view('10'));
    await saveLastChannel(key(3));
    await setPlayLastChannelOnOpen(true);
    const { router } = show('/live');
    await listbox('Channels in News');
    expect(router.state.location.pathname).toBe('/live/category/10');
    expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(3));
    expect(await screen.findByTestId('live-player')).toBeInTheDocument();
  });

  it('the redirect to the last channel reads the saved state once (no second entry)', async () => {
    await saveLiveView(SOURCE_ID, view('~all'));
    await saveLastChannel(key(3));
    await setPlayLastChannelOnOpen(true);
    const get = vi.spyOn(settingsRepo, 'get');
    const { router } = show('/live');
    await listbox('Channels in All');
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(3)),
    );
    expect(router.state.location.pathname).toBe('/live');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(get.mock.calls.filter(([k]) => k === 'liveViewState')).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('playing a channel records it as the last one', async () => {
    show('/live/category/10');
    const list = await listbox('Channels in News');
    act(() => list.focus());
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(async () =>
      expect((await loadLiveStartup(SOURCE_ID)).lastChannelKey).toBe(key(2)),
    );
  });
});

describe('LIV-03 AC3 — removed or foreign source', () => {
  it('a saved category that no longer exists falls back to All without errors', async () => {
    await saveLiveView(SOURCE_ID, view('gone', { selectedIndex: 4 }));
    const { router } = show('/live');
    await listbox('Channels in All');
    expect(router.state.location.pathname).toBe('/live');
    expect(getLogEntries().filter((e) => e.level === 'error')).toEqual([]);
  });

  it("another source's saved view and last channel are ignored", async () => {
    await saveLiveView('other', view('30', { selectedIndex: 99 }));
    await saveLastChannel(itemKey('other', 'live', '1'));
    await setPlayLastChannelOnOpen(true);
    const { router } = show('/live');
    await listbox('Channels in All');
    expect(router.state.location.pathname).toBe('/live');
    expect(router.state.location.search).toBe('');
  });

  it('the active source was removed: the next one opens on All without errors', async () => {
    await saveLiveView(SOURCE_ID, view('30'));
    await settingsRepo.set('activeSourceId', 'removed');
    const { router } = show('/live');
    // Falls back to the first source (EMPTY_SOURCE_ID, no channels) on "All".
    expect(await screen.findByRole('heading', { name: 'This category is empty.' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/live');
    expect((await loadLiveStartup(EMPTY_SOURCE_ID)).view).toBeUndefined();
    expect(getLogEntries().filter((e) => e.level === 'error')).toEqual([]);
  });
});
