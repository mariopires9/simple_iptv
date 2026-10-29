// EPG-01 on the Live screen (MSW panel, fake-indexeddb): now/next under the playing channel, the
// current programme on visible rows only (debounced), nothing at all without EPG, and no
// credentials in the logs. Request concurrency, cache and 429 backoff: epg.test.ts.
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type CatalogItemInput,
  type Source,
} from '@/core/db';
import { clearLogBuffer, getLogEntries, toLogJson } from '@/core/log';
import type { PlayerViewProps } from '@/player/ui';
import { CHANNEL_ROW_HEIGHT } from '@/ui/state';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { formatTime } from './epgFormat';
import { clearLiveState } from './liveState';
import { installScrollMetrics, renderLive } from './test-utils';

vi.mock('@/player/ui', () => ({
  PlayerView: (props: PlayerViewProps) => <div role="region" aria-label={props.title} />,
}));
vi.mock('@/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/player')>();
  return { ...actual, createPlayerController: vi.fn(() => ({ on: () => () => {} })) };
});

const SOURCE = 'xt';
const COUNT = 60;
/** Row 2 (channel 2) is the stream with EPG in the MSW panel (stream_id 1001). */
const streamOf = (n: number) => (n === 2 ? '1001' : String(5000 + n));
// Fixture programmes: 12:00–13:00 "Morning News", 13:00–14:00 "Notícias da Manhã" (UTC).
const START = Date.UTC(2026, 0, 1, 12, 0);
const T12_30 = Date.UTC(2026, 0, 1, 12, 30);

const source: Source = {
  id: SOURCE,
  kind: 'xtream',
  name: 'Panel',
  serverUrl: XTREAM_TEST_BASE_URL,
  username: XTREAM_TEST_CREDENTIALS.username,
  secretRef: 'xtream:xt',
  prefs: { liveFormat: 'm3u8' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const server = createMswServer(...xtreamHandlers());
let requested: string[] = [];

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  await sourcesRepo.put(source);
  const items: CatalogItemInput<'live'>[] = Array.from({ length: COUNT }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: '1',
    name: `Channel ${i + 1}`,
    number: i + 1,
    streamPath: streamOf(i + 1),
  }));
  await catalogRepo.replaceForSource(SOURCE, 'live', {
    categories: [{ externalId: '1', name: 'General' }],
    items,
  });
}, 60_000);

afterAll(async () => {
  server.close();
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeEach(async () => {
  restoreScroll = installScrollMetrics();
  vi.useFakeTimers({ toFake: ['Date'], now: T12_30 });
  requested = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('action') === 'get_short_epg') {
      requested.push(url.searchParams.get('stream_id') ?? '');
    }
  });
  clearLogBuffer();
  await settingsRepo.set('activeSourceId', SOURCE);
  vi.spyOn(credentialVault, 'get').mockResolvedValue(XTREAM_TEST_CREDENTIALS.password);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.resetHandlers();
  server.events.removeAllListeners();
  restoreScroll();
  media?.restore();
  media = undefined;
  await clearLiveState();
});

function show(path: string) {
  const view = renderLive(path);
  media = view.media;
  return view;
}

const listbox = () => screen.findByRole('listbox', { name: /^Channels in/ }, { timeout: 5000 });
const rowOf = (list: HTMLElement, n: number) =>
  within(list)
    .getAllByRole('option')
    .find((o) => o.getAttribute('aria-posinset') === String(n));
/** Rows whose stream ids were asked for (1-based row numbers). */
const requestedRows = () =>
  requested.map((id) => (id === '1001' ? 2 : Number(id) - 5000)).sort((a, b) => a - b);

describe('EPG-01 AC2/AC3 — current programme on the visible rows', () => {
  it('shows "now" on rows that have EPG, requests only the visible rows, never "N/A"', async () => {
    show('/live/category/1');
    const list = await listbox();
    const row2 = await waitFor(() => {
      const row = rowOf(list, 2);
      expect(row && within(row).getByTestId('row-now')).toHaveTextContent('Morning News');
      return row as HTMLElement;
    });
    expect(within(row2).getByTestId('row-now')).toHaveTextContent(/^, Now: Morning News$/);
    // Other rows have no EPG: nothing is shown for them (AC3).
    expect(within(list).getAllByTestId('row-now')).toHaveLength(1);
    expect(screen.queryByText(/N\/A/)).toBeNull();
    // The viewport has 10 rows; the 6 overscan rows below it are rendered but not requested.
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(10));
    expect(Math.max(...requestedRows())).toBeLessThanOrEqual(11);
    expect(new Set(requested).size).toBe(requested.length);
  });

  it('waits for scrolling to settle (300 ms) before asking for the new rows', async () => {
    show('/live/category/1');
    const list = await listbox();
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(10));
    requested = [];
    // Several scroll positions in quick succession: only the last one is requested.
    act(() => list.scrollTo({ top: 15 * CHANNEL_ROW_HEIGHT }));
    act(() => list.scrollTo({ top: 30 * CHANNEL_ROW_HEIGHT }));
    act(() => list.scrollTo({ top: 45 * CHANNEL_ROW_HEIGHT }));
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(10));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rows = requestedRows();
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(45);
  });
});

describe('EPG-01 AC1/AC4 — now/next under the playing channel', () => {
  it('shows Now (title, times, progress) and Next, in the device time zone', async () => {
    show('/live/category/1');
    const list = await listbox();
    await waitFor(() => expect(rowOf(list, 2)).toBeDefined());
    await userEvent.click(within(rowOf(list, 2) as HTMLElement).getByText('Channel 2'));
    const guide = await screen.findByRole('region', { name: 'Program guide' });
    const hour = 3_600_000;
    expect(guide).toHaveTextContent(
      `Now${formatTime(START)}–${formatTime(START + hour)}Morning News`,
    );
    expect(guide).toHaveTextContent(
      `Next${formatTime(START + hour)}–${formatTime(START + 2 * hour)}Notícias da Manhã`,
    );
    const progress = within(guide).getByRole('progressbar', {
      name: 'Progress of Morning News',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '50');
  });

  it('a channel without EPG shows no guide at all', async () => {
    show('/live/category/1');
    const list = await listbox();
    await waitFor(() => expect(rowOf(list, 3)).toBeDefined());
    await userEvent.click(within(rowOf(list, 3) as HTMLElement).getByText('Channel 3'));
    await screen.findByTestId('live-player');
    await waitFor(() => expect(requested).toContain(streamOf(3)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region', { name: 'Program guide' })).toBeNull();
  });

  it('never logs the credentials, even when the panel fails', async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_short_epg'] }));
    show('/live/category/1');
    await listbox();
    await waitFor(() => expect(requested.length).toBeGreaterThanOrEqual(10));
    await waitFor(() => expect(toLogJson(getLogEntries())).toContain('Network request failed'));
    const logs = toLogJson(getLogEntries());
    expect(logs).not.toContain(XTREAM_TEST_CREDENTIALS.password);
    expect(logs).not.toContain(`username=${XTREAM_TEST_CREDENTIALS.username}`);
    expect(screen.queryAllByTestId('row-now')).toHaveLength(0);
  });
});
