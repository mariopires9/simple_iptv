// LIV-02: playing channels from the Live screen — player per layout, zapping within the category,
// latest-wins resolution, the "Channels" panel, "Recent" after 5 s of playback, unsupported
// entries and the `?channel=` URL. PlayerView is mocked (its props are captured); the real one is
// covered by src/player/ui.
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultKeyLostError, credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  historyRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type CatalogItemInput,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries, toLogJson } from '@/core/log';
import { PlaybackError, type PlayerEvents, type StreamDescriptor } from '@/player';
import type { PlayerViewProps } from '@/player/ui';
import { clearLiveState } from './liveState';
import { PAGE_SIZE } from './pageCache';
import { resolveStream, type ResolvedStream } from './resolveStream';
import { installScrollMetrics, renderLive } from './test-utils';
import { RECENT_AFTER_MS } from './useWatchTimer';
import { ZAP_SETTLE_MS } from './zapping';

// --- mocks ---------------------------------------------------------------------------------

const views: PlayerViewProps[] = [];
const lastView = () => {
  const props = views.at(-1);
  if (!props) throw new Error('PlayerView not rendered');
  return props;
};

// Like the real PlayerView (autoFocus), the region takes focus once, when it mounts.
const focused = new WeakSet<HTMLElement>();
const focusOnMount = (el: HTMLElement | null) => {
  if (el && !focused.has(el)) {
    focused.add(el);
    el.focus();
  }
};

vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => {
    views.push(props);
    return (
      <div ref={focusOnMount} role="region" aria-label={`Player: ${props.title}`} tabIndex={-1}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- test double */}
        <video data-testid="mock-video" />
        <span data-testid="mock-title">{props.title}</span>
      </div>
    );
  },
}));

type ErrorListener = (e: PlayerEvents['error']) => void;
type AttemptListener = (e: PlayerEvents['attempt']) => void;
const errorListeners: ErrorListener[] = [];
const attemptListeners: AttemptListener[] = [];
vi.mock('@/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/player')>();
  return {
    ...actual,
    createPlayerController: vi.fn(() => ({
      on: (evt: string, cb: ErrorListener & AttemptListener) => {
        if (evt === 'error') errorListeners.push(cb);
        if (evt === 'attempt') attemptListeners.push(cb);
        return () => {};
      },
    })),
  };
});
const emitError = (status: number) =>
  act(() => {
    for (const cb of errorListeners) cb(new PlaybackError({ kind: 'auth', status }));
  });
const emitAttempt = (url: string) =>
  act(() => {
    for (const cb of attemptListeners) {
      cb({ engine: 'mpegts', attempt: 0, descriptor: { url, kind: 'live', container: 'ts' } });
    }
  });

// No now/next requests here (EPG-01 has its own tests, with MSW).
vi.mock('./epg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epg')>();
  return { ...actual, createEpgService: () => undefined };
});

vi.mock('./resolveStream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolveStream')>();
  return { ...actual, resolveStream: vi.fn(actual.resolveStream) };
});
const resolveMock = vi.mocked(resolveStream);

// --- catalogue -----------------------------------------------------------------------------

// Synthetic credentials only.
const PASS = 'synthetic-secret-42';
const XTREAM = 'x1';
const M3U = 'm1';
const BIG = PAGE_SIZE + 5;

const xtream: Source = {
  id: XTREAM,
  kind: 'xtream',
  name: 'Xtream list',
  serverUrl: 'http://xtream.example:8080',
  username: 'demo',
  secretRef: 'xtream:x1',
  prefs: { liveFormat: 'm3u8' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const m3u: Source = {
  id: M3U,
  kind: 'm3u-url',
  name: 'M3U list',
  prefs: { liveFormat: 'auto' },
  createdAt: 2,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

/** Xtream channels: News 1–3, Sports 4–5, Big 6…(5 + BIG). */
const xkey = (n: number) => itemKey(XTREAM, 'live', String(n));
const mkey = (id: string) => itemKey(M3U, 'live', id);
const urlOf = (n: number) => `http://xtream.example:8080/live/demo/${PASS}/${n}.m3u8`;

async function seed() {
  await sourcesRepo.put(xtream);
  await sourcesRepo.put(m3u);
  const items: CatalogItemInput<'live'>[] = [];
  const add = (cat: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const n = items.length + 1;
      items.push({
        externalId: String(n),
        categoryExternalId: cat,
        name: `Channel ${n}`,
        number: n,
        streamPath: String(n),
      });
    }
  };
  add('1', 3);
  add('2', 2);
  add('3', BIG);
  await catalogRepo.replaceForSource(XTREAM, 'live', {
    categories: [
      { externalId: '1', name: 'News' },
      { externalId: '2', name: 'Sports' },
      { externalId: '3', name: 'Big' },
    ],
    items,
  });
  // M3U entries with the SRC-04 flags (written by the M3U provider on another branch).
  const entry = (id: string, name: string, extra: Record<string, unknown>) =>
    ({
      externalId: id,
      categoryExternalId: 'g',
      name,
      streamPath: `https://cdn.example/${id}.ts`,
      ...extra,
    }) as CatalogItemInput<'live'>;
  await catalogRepo.replaceForSource(M3U, 'live', {
    categories: [{ externalId: 'g', name: 'General' }],
    items: [
      entry('drm', 'Protected', { drm: { system: 'widevine' } }),
      entry('dash', 'Dash channel', { streamUrl: 'https://cdn.example/m.mpd' }),
      entry('hdr', 'Referer channel', { requiredHeaders: { Referer: 'https://site.example/' } }),
      entry('ok', 'Plain channel', { streamUrl: 'https://cdn.example/ok.m3u8', container: 'hls' }),
    ],
  });
}

// --- harness -------------------------------------------------------------------------------

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeAll(async () => {
  await seed();
}, 60_000);

afterAll(async () => {
  await wipeAll();
});

beforeEach(async () => {
  restoreScroll = installScrollMetrics();
  views.length = 0;
  errorListeners.length = 0;
  attemptListeners.length = 0;
  // Back to the real resolveStream (a test may have replaced the implementation).
  resolveMock.mockReset();
  clearLogBuffer();
  await settingsRepo.set('activeSourceId', XTREAM);
  vi.spyOn(credentialVault, 'get').mockResolvedValue(PASS);
});

afterEach(async () => {
  vi.useRealTimers();
  restoreScroll();
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  const recent = await historyRepo.listRecent(XTREAM, 'live', 100);
  await Promise.all(recent.map((h) => historyRepo.remove(h.itemKey)));
  // Unmount first: the screen flushes its saved view (LIV-03) when it goes away.
  cleanup();
  await clearLiveState();
});

function show(path: string, width?: number) {
  const view = renderLive(path, width);
  media = view.media;
  return view;
}

const channelParam = (router: { state: { location: { search: string } } }) =>
  new URLSearchParams(router.state.location.search).get('channel');

const activeOf = (list: HTMLElement) => {
  const id = list.getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
};

const listbox = (name: string | RegExp = /^Channels in/) =>
  screen.findByRole('listbox', { name }, { timeout: 5000 });

/** The PlayerView received this descriptor URL (and the title shown with it). */
const playerShows = async (n: number) =>
  waitFor(() => {
    expect(lastView().descriptor.url).toBe(urlOf(n));
    expect(lastView().title).toBe(`Channel ${n}`);
  });

async function openFrom(path: string, name: string, width?: number) {
  const view = show(path, width);
  const list = await listbox();
  await userEvent.click(await within(list).findByText(name));
  return { ...view, list };
}

// --- tests ---------------------------------------------------------------------------------

describe('LIV-02 AC1 — opening the player', () => {
  it('desktop: clicking a channel replaces the placeholder panel and starts playback', async () => {
    const { router } = show('/live/category/1', 1400);
    const list = await listbox('Channels in News');
    expect(screen.getByText('Select a channel to watch it here.')).toBeInTheDocument();
    await userEvent.click(await within(list).findByText('Channel 2'));
    await playerShows(2);
    expect(lastView().kind).toBe('live');
    expect(lastView().descriptor).toEqual({ url: urlOf(2), kind: 'live', container: 'hls' });
    expect(screen.queryByText('Select a channel to watch it here.')).toBeNull();
    expect(channelParam(router)).toBe(xkey(2));
    // Categories | list | player.
    expect(screen.getByRole('navigation', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Watching Channel 2');
  });

  it('Enter on the focused list opens the player', async () => {
    const user = userEvent.setup();
    show('/live/category/1', 1400);
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await playerShows(2);
  });

  it('mobile: a 16:9 player pinned above the category chips and the list', async () => {
    await openFrom('/live/category/1', 'Channel 1', 400);
    await playerShows(1);
    const player = screen.getByTestId('live-player');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root').length).toBeGreaterThan(0);
    expect(player.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('tablet: list | video, with the categories as chips above the list while playing', async () => {
    show('/live/category/1', 900);
    const list = await listbox('Channels in News');
    let nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(0);
    await userEvent.click(await within(list).findByText('Channel 3'));
    await playerShows(3);
    nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root').length).toBeGreaterThan(0);
    const player = screen.getByTestId('live-player');
    expect(nav.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('LIV-02 AC2 — previous/next within the category', () => {
  it('↑/↓ (onPrevious/onNext) stay in the category and wrap around', async () => {
    const { router } = await openFrom('/live/category/1', 'Channel 3', 1400);
    await playerShows(3);
    act(() => lastView().onNext?.());
    // The name is shown at once, before the stream is resolved.
    await waitFor(() => expect(lastView().title).toBe('Channel 1'));
    expect(channelParam(router)).toBe(xkey(1));
    expect(screen.getByTestId('zap-osd')).toHaveTextContent('1 · Channel 1');
    await playerShows(1);
    act(() => lastView().onPrevious?.());
    await waitFor(() => expect(lastView().title).toBe('Channel 3'));
    await playerShows(3);
    // Never Sports (channels 4–5).
    expect(views.some((v) => v.title === 'Channel 4')).toBe(false);
  });

  it('crosses page boundaries (restored channel, index located through the pager)', async () => {
    const last = 5 + PAGE_SIZE; // row PAGE_SIZE − 1 of Big = last row of page 0
    show(`/live/category/3?channel=${encodeURIComponent(xkey(last))}`, 1400);
    await playerShows(last);
    act(() => lastView().onNext?.());
    await playerShows(last + 1); // first row of page 1
    act(() => lastView().onNext?.());
    await playerShows(last + 2);
    act(() => lastView().onPrevious?.());
    act(() => lastView().onPrevious?.());
    act(() => lastView().onPrevious?.());
    await playerShows(last - 1);
  }, 20_000);
});

describe('LIV-02 AC3 — rapid zapping', () => {
  it('5 changes in 2 s: names follow at once, only the last channel is resolved and loaded', async () => {
    await openFrom('/live/category/3', 'Channel 6', 1400);
    await playerShows(6);
    resolveMock.mockClear();
    const before = views.length;
    // Back-to-back presses (the strictest case of "5 changes in 2 s"): no real-time waits, so the
    // outcome doesn't depend on how fast neighbour lookups run on a loaded machine.
    await act(async () => {
      for (let i = 0; i < 5; i++) lastView().onNext?.();
    });
    await waitFor(() => expect(lastView().title).toBe('Channel 11'));
    await playerShows(11);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock.mock.calls[0]?.[0].key).toBe(xkey(11));
    const loaded = new Set(views.slice(before).map((v) => v.descriptor.url));
    expect([...loaded]).toEqual([urlOf(6), urlOf(11)]);
    expect(ZAP_SETTLE_MS).toBeLessThan(1_000);
  });

  it('a slow resolution that finishes after a newer pick is dropped (latest wins)', async () => {
    const pending = new Map<string, (r: ResolvedStream) => void>();
    resolveMock.mockImplementation(
      (channel) =>
        new Promise<ResolvedStream>((resolve) => {
          pending.set(channel.key, resolve);
        }),
    );
    show('/live/category/1', 1400);
    const list = await listbox('Channels in News');
    await userEvent.click(await within(list).findByText('Channel 1'));
    await userEvent.click(within(list).getByText('Channel 2'));
    await waitFor(() => expect(pending.size).toBe(2));
    const ok = (n: number): ResolvedStream => ({
      status: 'ok',
      requiredHeaders: false,
      descriptor: { url: urlOf(n), kind: 'live', container: 'hls' } satisfies StreamDescriptor,
    });
    await act(async () => {
      pending.get(xkey(2))?.(ok(2));
    });
    await act(async () => {
      pending.get(xkey(1))?.(ok(1));
    });
    await playerShows(2);
    expect(views.some((v) => v.descriptor.url === urlOf(1))).toBe(false);
  });
});

describe('LIV-02 AC4 — "Channels" panel over the player', () => {
  it('L / the list button opens it; picking a channel plays it and closes the panel', async () => {
    await openFrom('/live/category/1', 'Channel 1', 1400);
    await playerShows(1);
    act(() => lastView().onToggleChannelList?.());
    const panel = await screen.findByRole('dialog', { name: 'Channels' });
    const list = await within(panel).findByRole('listbox', { name: 'Channels in News' });
    await waitFor(() => expect(list).toHaveFocus());
    await userEvent.click(await within(list).findByText('Channel 3'));
    await playerShows(3);
    expect(screen.queryByRole('dialog', { name: 'Channels' })).toBeNull();
    // Zapping continues from the row picked in the panel.
    act(() => lastView().onNext?.());
    await playerShows(1);
  });

  it('Esc and the close button close it without changing the channel', async () => {
    const user = userEvent.setup();
    await openFrom('/live/category/1', 'Channel 2', 1400);
    await playerShows(2);
    act(() => lastView().onToggleChannelList?.());
    const panel = await screen.findByRole('dialog', { name: 'Channels' });
    await waitFor(() => expect(within(panel).getByRole('listbox')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Focus is back on the player region (its shortcuts work again).
    expect(screen.getByRole('region', { name: 'Player: Channel 2' })).toHaveFocus();
    act(() => lastView().onToggleChannelList?.());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Close the channel list',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Player: Channel 2' })).toHaveFocus();
    expect(lastView().title).toBe('Channel 2');
  });

  it("reuses the main list's page cache: opening the panel reads nothing again", async () => {
    await openFrom('/live/category/1', 'Channel 2', 1400);
    await playerShows(2);
    const read = vi.spyOn(catalogRepo, 'listByCategory');
    for (let i = 0; i < 2; i++) {
      act(() => lastView().onToggleChannelList?.());
      const panel = await screen.findByRole('dialog', { name: 'Channels' });
      expect(await within(panel).findByText('Channel 3')).toBeInTheDocument();
      act(() => lastView().onToggleChannelList?.());
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('a new category (pager) resets the panel list to its first row', async () => {
    await openFrom('/live/category/1', 'Channel 3', 1400);
    await playerShows(3);
    act(() => lastView().onToggleChannelList?.());
    let panel = await screen.findByRole('dialog', { name: 'Channels' });
    const news = within(panel).getByRole('listbox', { name: 'Channels in News' });
    await waitFor(() => expect(activeOf(news)).toHaveAttribute('aria-posinset', '3'));
    await userEvent.click(screen.getByRole('link', { name: 'Sports' }));
    panel = await screen.findByRole('dialog', { name: 'Channels' });
    const sports = await within(panel).findByRole('listbox', { name: 'Channels in Sports' });
    await waitFor(() => expect(activeOf(sports)).toHaveAttribute('aria-posinset', '1'));
    expect(sports.querySelector('[aria-setsize]')).toHaveAttribute('aria-setsize', '2');
  });
});

describe('LIV-02 AC5 — "Recent" after 5 s of playback', () => {
  it('records the channel after 5 s of playing, not before, and not while paused', async () => {
    const upsert = vi.spyOn(historyRepo, 'upsert');
    await openFrom('/live/category/1', 'Channel 2', 1400);
    await playerShows(2);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const video = screen.getByTestId('mock-video');
    act(() => {
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(3_000);
      video.dispatchEvent(new Event('pause'));
      vi.advanceTimersByTime(10_000);
    });
    expect(upsert).not.toHaveBeenCalled();
    act(() => {
      video.dispatchEvent(new Event('playing'));
      vi.advanceTimersByTime(RECENT_AFTER_MS - 3_000 - 100);
    });
    expect(upsert).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({ itemKey: xkey(2) });
    vi.useRealTimers();
    await waitFor(async () =>
      expect((await historyRepo.listRecent(XTREAM, 'live')).map((h) => h.itemKey)).toEqual([
        xkey(2),
      ]),
    );
  });

  it('a channel that never plays (or is zapped past) is not recorded', async () => {
    const upsert = vi.spyOn(historyRepo, 'upsert');
    await openFrom('/live/category/1', 'Channel 1', 1400);
    await playerShows(1);
    // Deterministic clock: nothing advances unless the test says so.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await act(() => vi.advanceTimersByTimeAsync(RECENT_AFTER_MS * 2));
    expect(upsert).not.toHaveBeenCalled();
    // Playing for 2 s, then zapped away: channel 1 is not recorded, and channel 2 only counts
    // once its own stream plays.
    const video = screen.getByTestId('mock-video');
    await act(async () => {
      video.dispatchEvent(new Event('playing'));
      await vi.advanceTimersByTimeAsync(2_000);
      lastView().onNext?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(lastView().title).toBe('Channel 2');
    await act(() => vi.advanceTimersByTimeAsync(RECENT_AFTER_MS));
    expect(upsert).not.toHaveBeenCalled();
    expect(lastView().descriptor.url).toBe(urlOf(2));
    await act(async () => {
      video.dispatchEvent(new Event('playing'));
      await vi.advanceTimersByTimeAsync(RECENT_AFTER_MS);
    });
    expect(upsert).toHaveBeenCalledExactlyOnceWith({ itemKey: xkey(2) });
  });
});

describe('LIV-02 — stream resolution in the player area', () => {
  it('never logs the password', async () => {
    await openFrom('/live/category/1', 'Channel 1', 1400);
    await playerShows(1);
    expect(toLogJson(getLogEntries())).not.toContain(PASS);
  });

  it('a lost vault key asks to re-enter the password, with a link to My lists', async () => {
    vi.spyOn(credentialVault, 'get').mockRejectedValue(
      new VaultKeyLostError('xtream:x1', 'missing-key'),
    );
    await openFrom('/live/category/1', 'Channel 1', 1400);
    expect(
      await screen.findByRole('heading', { name: 'Re-enter the password for this list' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My lists' })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    expect(views).toHaveLength(0);
  });

  it.each([
    ['Protected', mkey('drm')],
    ['Dash channel', mkey('dash')],
  ])('%s (DRM/DASH) is not attempted and says why', async (name) => {
    await settingsRepo.set('activeSourceId', M3U);
    await openFrom('/live', name, 1400);
    expect(
      await screen.findByRole('heading', {
        name: 'This channel uses DRM / DASH, which this app does not support',
      }),
    ).toBeInTheDocument();
    expect(views).toHaveLength(0);
  });

  it('an entry with required headers plays, and explains a 401/403 failure', async () => {
    await settingsRepo.set('activeSourceId', M3U);
    await openFrom('/live', 'Referer channel', 1400);
    await waitFor(() => expect(lastView().descriptor.url).toBe('https://cdn.example/hdr.ts'));
    const factory = lastView().createController;
    if (!factory) throw new Error('no controller factory');
    factory(document.createElement('video'));
    expect(screen.queryByRole('alert')).toBeNull();
    emitError(403);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The provider restricts playback to its own app/site',
    );
  });

  it('the restricted warning only reflects the current attempt (retry, zap away and back)', async () => {
    await settingsRepo.set('activeSourceId', M3U);
    await openFrom('/live', 'Referer channel', 1400);
    await waitFor(() => expect(lastView().descriptor.url).toBe('https://cdn.example/hdr.ts'));
    lastView().createController?.(document.createElement('video'));
    emitError(403);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // PlayerView's "Try again" starts a new play(): the old failure no longer applies.
    emitAttempt('https://cdn.example/hdr.ts');
    expect(screen.queryByRole('alert')).toBeNull();

    emitError(401);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // Zap away (the controller starts the new stream)…
    act(() => lastView().onNext?.());
    await waitFor(() => expect(lastView().descriptor.url).toBe('https://cdn.example/ok.m3u8'), {
      timeout: 3000,
    });
    emitAttempt('https://cdn.example/ok.m3u8');
    expect(screen.queryByRole('alert')).toBeNull();
    // …and back: the new attempt starts clean until it fails itself.
    act(() => lastView().onPrevious?.());
    await waitFor(() => expect(lastView().descriptor.url).toBe('https://cdn.example/hdr.ts'), {
      timeout: 3000,
    });
    emitAttempt('https://cdn.example/hdr.ts');
    expect(screen.queryByRole('alert')).toBeNull();
    emitError(403);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('retrying after a resolve error shows progress, then the new result', async () => {
    let release: (value: string) => void = () => {};
    vi.spyOn(credentialVault, 'get')
      .mockRejectedValueOnce(new Error('database closed'))
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      );
    await openFrom('/live/category/1', 'Channel 1', 1400);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('heading', { name: "Couldn't start this channel" })).toBeNull();
    expect(screen.getByTestId('player-pending')).toHaveTextContent('Loading Channel 1');
    await act(async () => {
      release(PASS);
    });
    await playerShows(1);
  });

  it('the same failure on an entry without required headers keeps the player message only', async () => {
    await settingsRepo.set('activeSourceId', M3U);
    await openFrom('/live', 'Plain channel', 1400);
    await waitFor(() => expect(lastView().descriptor.container).toBe('hls'));
    lastView().createController?.(document.createElement('video'));
    act(() => {
      for (const cb of errorListeners) cb(new PlaybackError({ kind: 'auth', status: 401 }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LIV-02 — ?channel= in the URL', () => {
  it('a reload restores the channel; closing the player clears it', async () => {
    const { router } = show(`/live/category/1?channel=${encodeURIComponent(xkey(3))}`, 1400);
    await playerShows(3);
    act(() => lastView().onClose?.());
    await waitFor(() => expect(channelParam(router)).toBeNull());
    expect(router.state.location.pathname).toBe('/live/category/1');
    expect(screen.queryByTestId('live-player')).toBeNull();
    expect(screen.getByText('Select a channel to watch it here.')).toBeInTheDocument();
  });

  it('switching category keeps the channel playing', async () => {
    const { router } = await openFrom('/live/category/1', 'Channel 2', 1400);
    await playerShows(2);
    await userEvent.click(screen.getByRole('link', { name: 'Sports' }));
    expect(router.state.location.pathname).toBe('/live/category/2');
    expect(channelParam(router)).toBe(xkey(2));
    await listbox('Channels in Sports');
    expect(lastView().title).toBe('Channel 2');
    // Zapping now follows Sports: the channel is not in it, so ↓ starts at its first row.
    act(() => lastView().onNext?.());
    await playerShows(4);
  });

  it('an unknown channel key is dropped from the URL', async () => {
    const { router } = show(`/live/category/1?channel=${encodeURIComponent(xkey(999))}`, 1400);
    await listbox('Channels in News');
    await waitFor(() => expect(channelParam(router)).toBeNull());
    expect(views).toHaveLength(0);
  });
});
