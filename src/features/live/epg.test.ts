// EPG-01: the now/next service — cache (5 min), max. 6 concurrent requests, dropped requests for
// rows that scrolled away, 429 backoff, auth rejection, no credentials in the logs (MSW).
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, Source } from '@/core/db';
import { clearLogBuffer, getLogEntries, toLogJson } from '@/core/log';
import { XTREAM_TEST_BASE_URL, xtreamFixtures, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import {
  BACKOFF_INITIAL_MS,
  CACHE_TTL_MS,
  MAX_CONCURRENT,
  createEpgService,
  currentProgramme,
  nextProgramme,
  type EpgService,
} from './epg';

// Synthetic credentials (the MSW panel's defaults).
const USER = 'jdoe';
const PASS = 'testpass';
// Fixture programmes: 12:00–13:00, 13:00–14:00… UTC on 2026-01-01.
const T12_30 = Date.UTC(2026, 0, 1, 12, 30);

const source: Source = {
  id: 'x',
  kind: 'xtream',
  name: 'Panel',
  serverUrl: XTREAM_TEST_BASE_URL,
  username: USER,
  secretRef: 'xtream:x',
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

const channel = (streamId: string | number): Channel => ({
  key: `x:live:${streamId}`,
  sourceId: 'x',
  type: 'live',
  externalId: String(streamId),
  name: `Channel ${streamId}`,
  nameNorm: `channel ${streamId}`,
  order: 0,
  streamPath: String(streamId),
});

const vault = { get: vi.fn(() => Promise.resolve<string | undefined>(PASS)) };

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

/** Every `get_short_epg` request's stream id, in order. */
let requested: string[];
beforeEach(() => {
  requested = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('action') === 'get_short_epg') {
      requested.push(url.searchParams.get('stream_id') ?? '');
    }
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T12_30 });
  clearLogBuffer();
});

let service: EpgService | undefined;
afterEach(() => {
  service?.cancel();
  service = undefined;
  server.resetHandlers();
  server.events.removeAllListeners();
  vi.useRealTimers();
});

function start(): EpgService {
  service = createEpgService(source, { vault });
  if (!service) throw new Error('no service');
  return service;
}

/**
 * Waits for `promise` while advancing the fake clock (MSW and the fetch helpers use timers).
 */
async function settled<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await vi.waitFor(() => expect(done).toBe(true));
  return promise;
}

/** A panel whose `get_short_epg` answers only when released. */
function heldPanel() {
  const release: (() => void)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  server.use(
    http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      return HttpResponse.json({ epg_listings: [] });
    }),
  );
  return {
    get max() {
      return maxInFlight;
    },
    releaseAll: () => {
      for (const r of release.splice(0)) r();
    },
  };
}

describe('createEpgService', () => {
  it('is only for Xtream sources', () => {
    expect(createEpgService({ ...source, kind: 'm3u-url' })).toBeUndefined();
  });

  it('loads now/next of a channel (limit 2, decoded titles)', async () => {
    const epg = start();
    const programmes = await settled(epg.load(channel(1001)));
    expect(programmes.map((p) => p.title)).toEqual(['Morning News', 'Notícias da Manhã']);
    expect(currentProgramme(programmes, T12_30)?.title).toBe('Morning News');
    expect(nextProgramme(programmes, T12_30)?.title).toBe('Notícias da Manhã');
    expect(epg.peek(channel(1001))).toBe(programmes);
  });

  it('caches answers (also "no EPG") for 5 minutes', async () => {
    const epg = start();
    await settled(epg.load(channel(1001)));
    await settled(epg.load(channel(7)));
    await settled(epg.load(channel(1001)));
    await settled(epg.load(channel(7)));
    expect(requested).toEqual(['1001', '7']);
    expect(epg.peek(channel(7))).toEqual([]);

    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS + 1);
    // Still 12:35 < 13:00: the entry is only stale because of its age.
    expect(epg.peek(channel(7))).toBeUndefined();
    await settled(epg.load(channel(7)));
    expect(requested).toEqual(['1001', '7', '7']);
  });

  it('refreshes before 5 minutes once the current programme has ended', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 58));
    const epg = start();
    await settled(epg.load(channel(1001)));
    vi.setSystemTime(Date.UTC(2026, 0, 1, 13, 0, 30));
    expect(epg.peek(channel(1001))).toBeUndefined();
  });

  it('never has more than 6 requests in flight; the rest wait their turn', async () => {
    const panel = heldPanel();
    const epg = start();
    const loads = Array.from({ length: 20 }, (_, i) => epg.load(channel(i + 1)));
    await vi.waitFor(() => expect(requested).toHaveLength(MAX_CONCURRENT));
    expect(panel.max).toBe(MAX_CONCURRENT);
    for (let round = 0; round < 4; round++) {
      panel.releaseAll();
      await vi.waitFor(() =>
        expect(requested.length).toBe(Math.min(20, MAX_CONCURRENT * (round + 2))),
      );
    }
    panel.releaseAll();
    await Promise.all(loads);
    expect(panel.max).toBe(MAX_CONCURRENT);
    expect(new Set(requested).size).toBe(20);
  });

  it('drops queued requests whose rows scrolled away (aborted) without sending them', async () => {
    const panel = heldPanel();
    const epg = start();
    const visible = new AbortController();
    const first = Array.from({ length: 6 }, (_, i) => epg.load(channel(i + 1)));
    const queued = Array.from({ length: 6 }, (_, i) =>
      epg.load(channel(100 + i), { signal: visible.signal }),
    );
    await vi.waitFor(() => expect(requested).toHaveLength(6));
    visible.abort();
    await Promise.all(queued.map((p) => expect(p).rejects.toMatchObject({ name: 'AbortError' })));
    panel.releaseAll();
    await Promise.all(first);
    expect(requested.some((id) => Number(id) >= 100)).toBe(false);
  });

  it('a priority load (the playing channel) jumps the queue', async () => {
    const panel = heldPanel();
    const epg = start();
    const rows = Array.from({ length: 10 }, (_, i) => epg.load(channel(i + 1)));
    const playing = epg.load(channel(1001), { priority: true });
    // Rows 1–6 started at once; 7–10 were queued when the playing channel arrived.
    await vi.waitFor(() => expect(requested).toHaveLength(6));
    panel.releaseAll();
    await vi.waitFor(() => expect(requested).toHaveLength(11));
    expect(requested[6]).toBe('1001');
    panel.releaseAll();
    await Promise.all([...rows, playing]);
  });

  it('backs off on 429: pauses every request, then retries the throttled one', async () => {
    let throttle = 1;
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, ({ request }) => {
        if (throttle > 0) {
          throttle--;
          return new HttpResponse(null, { status: 429 });
        }
        const id = new URL(request.url).searchParams.get('stream_id');
        return HttpResponse.json(id === '1001' ? xtreamFixtures.shortEpg : { epg_listings: [] });
      }),
    );
    const epg = start();
    const throttled = epg.load(channel(1001));
    await vi.waitFor(() => expect(requested).toEqual(['1001']));
    // Let the 429 settle, then ask for another channel: nothing is sent during the backoff.
    await vi.advanceTimersByTimeAsync(10);
    const other = epg.load(channel(5));
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS - 100);
    expect(requested).toEqual(['1001']);
    await vi.advanceTimersByTimeAsync(200);
    const programmes = await throttled;
    await other;
    expect(programmes.map((p) => p.title)).toContain('Morning News');
    expect(requested).toEqual(['1001', '1001', '5']);
  });

  it('doubles the backoff on repeated 429s', async () => {
    let throttle = 2;
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () => {
        if (throttle > 0) {
          throttle--;
          return new HttpResponse(null, { status: 429 });
        }
        return HttpResponse.json({ epg_listings: [] });
      }),
    );
    const epg = start();
    const load = epg.load(channel(1));
    await vi.waitFor(() => expect(requested).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS + 10);
    await vi.waitFor(() => expect(requested).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS + 10);
    expect(requested).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    await load;
    expect(requested).toHaveLength(3);
  });

  it('a server error shows nothing and is not retried within the cache period', async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_short_epg'] }));
    const epg = start();
    expect(await settled(epg.load(channel(1001)))).toEqual([]);
    expect(await settled(epg.load(channel(1001)))).toEqual([]);
    expect(requested).toEqual(['1001']);
  });

  it('a rejected login turns the service off', async () => {
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const epg = start();
    expect(await settled(epg.load(channel(1001)))).toEqual([]);
    expect(await settled(epg.load(channel(2)))).toEqual([]);
    expect(requested).toEqual(['1001']);
  });

  it('without a stored password it sends nothing', async () => {
    vault.get.mockResolvedValueOnce(undefined);
    const epg = start();
    expect(await settled(epg.load(channel(1001)))).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('cancel() aborts what is in flight without caching it; the service stays usable', async () => {
    const panel = heldPanel();
    const epg = start();
    const pending = epg.load(channel(1001));
    await vi.waitFor(() => expect(requested).toHaveLength(1));
    epg.cancel();
    expect(await pending).toEqual([]);
    expect(epg.peek(channel(1001))).toBeUndefined();
    server.resetHandlers();
    const second = epg.load(channel(1001));
    await vi.waitFor(() => expect(requested).toHaveLength(2));
    expect((await settled(second)).length).toBe(2);
    panel.releaseAll();
  });

  it('never logs the credentials', async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_short_epg'] }));
    const epg = start();
    await settled(epg.load(channel(1001)));
    const logs = toLogJson(getLogEntries());
    expect(logs).toContain('Network request failed');
    expect(logs).not.toContain(PASS);
    expect(logs).not.toContain(`username=${USER}`);
  });
});
