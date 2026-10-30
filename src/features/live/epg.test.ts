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
  MIN_REFETCH_MS,
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

/**
 * Every held panel response. Released (and given time to finish) after each test: a response
 * still pending when the next test starts would land in that test's requests.
 */
const holds: (() => void)[] = [];

let service: EpgService | undefined;
afterEach(async () => {
  service?.cancel();
  service = undefined;
  vi.useRealTimers();
  for (const release of holds.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  server.resetHandlers();
  server.events.removeAllListeners();
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
      await new Promise<void>((resolve) => {
        release.push(resolve);
        holds.push(resolve);
      });
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

  it('keeps the entry when the first programme ends and the next one is on air', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 58));
    const epg = start();
    await settled(epg.load(channel(1001)));
    vi.setSystemTime(Date.UTC(2026, 0, 1, 13, 0, 30));
    const programmes = epg.peek(channel(1001));
    expect(currentProgramme(programmes, Date.now())?.title).toBe('Notícias da Manhã');
    await settled(epg.load(channel(1001)));
    expect(requested).toEqual(['1001']);
  });

  it('refreshes before 5 minutes once every programme of the entry has ended', async () => {
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
        HttpResponse.json({
          epg_listings: [
            {
              title: 'Last',
              start_timestamp: Date.UTC(2026, 0, 1, 12) / 1000,
              stop_timestamp: Date.UTC(2026, 0, 1, 13) / 1000,
            },
          ],
        }),
      ),
    );
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 58));
    const epg = start();
    await settled(epg.load(channel(9)));
    expect(epg.peek(channel(9))).toHaveLength(1);
    vi.setSystemTime(Date.UTC(2026, 0, 1, 13, 0, 30));
    expect(epg.peek(channel(9))).toBeUndefined();
  });

  // QA-02 defect: the fixture's programmes (2026-01-01) have all ended on a later clock; the
  // entry used to be stale at once, so every re-render asked the panel again (request loop).
  describe('stale or empty EPG (no request loop)', () => {
    /** A list that re-asks whatever `peek` does not know on every notification (ChannelList). */
    function renderLoop(epg: EpgService, ch: Channel) {
      let renders = 0;
      const render = () => {
        renders++;
        if (renders > 500) return;
        if (epg.peek(ch) === undefined) void epg.load(ch).catch(() => undefined);
      };
      const unsubscribe = epg.subscribe(render);
      render();
      return { unsubscribe, render };
    }

    it('asks once per TTL for a channel whose programmes have all ended', async () => {
      vi.setSystemTime(Date.UTC(2026, 9, 29, 20));
      const epg = start();
      const loop = renderLoop(epg, channel(1001));
      const programmes = await settled(epg.load(channel(1001)));
      expect(programmes.length).toBeGreaterThan(0);
      expect(currentProgramme(programmes, Date.now())).toBeUndefined();
      for (let i = 0; i < 50; i++) loop.render();
      await vi.advanceTimersByTimeAsync(1_000);
      for (let i = 0; i < 50; i++) await settled(epg.load(channel(1001)));
      expect(requested).toEqual(['1001']);
      expect(epg.peek(channel(1001))).toBe(programmes);

      await vi.advanceTimersByTimeAsync(CACHE_TTL_MS / 2);
      await settled(epg.load(channel(1001)));
      expect(requested).toEqual(['1001']);
      await vi.advanceTimersByTimeAsync(CACHE_TTL_MS / 2);
      await settled(epg.load(channel(1001)));
      expect(requested).toEqual(['1001', '1001']);
      loop.unsubscribe();
    });

    it('asks once per TTL for a channel with an empty EPG', async () => {
      server.use(
        http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
          HttpResponse.json({ epg_listings: [] }),
        ),
      );
      const epg = start();
      const loop = renderLoop(epg, channel(7));
      await settled(epg.load(channel(7)));
      for (let i = 0; i < 50; i++) {
        loop.render();
        await settled(epg.load(channel(7)));
      }
      expect(requested).toEqual(['7']);
      loop.unsubscribe();
    });

    it('shares one request among concurrent callers of the same channel', async () => {
      const epg = start();
      await settled(Promise.all(Array.from({ length: 30 }, () => epg.load(channel(1001)))));
      expect(requested).toEqual(['1001']);
    });

    it('never asks again sooner than the minimum interval, even when the programme ends', async () => {
      server.use(
        http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () =>
          HttpResponse.json({
            epg_listings: [
              {
                title: 'Ending',
                start_timestamp: Date.UTC(2026, 0, 1, 12) / 1000,
                stop_timestamp: (T12_30 + 5_000) / 1000,
              },
            ],
          }),
        ),
      );
      const epg = start();
      await settled(epg.load(channel(9)));
      await vi.advanceTimersByTimeAsync(10_000);
      // The programme ended 5 s ago; the entry is kept until the minimum interval.
      expect(epg.peek(channel(9))).toHaveLength(1);
      await settled(epg.load(channel(9)));
      expect(requested).toEqual(['9']);
      await vi.advanceTimersByTimeAsync(MIN_REFETCH_MS);
      expect(epg.peek(channel(9))).toBeUndefined();
      await settled(epg.load(channel(9)));
      expect(requested).toEqual(['9', '9']);
    });
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

  it('6 parallel 429s are one throttle episode; the backoff grows 5 s → 10 s → 20 s', async () => {
    let throttledRounds = 3;
    let inRound = 0;
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, () => {
        if (throttledRounds > 0) {
          if (++inRound === MAX_CONCURRENT) {
            inRound = 0;
            throttledRounds--;
          }
          return new HttpResponse(null, { status: 429 });
        }
        return HttpResponse.json({ epg_listings: [] });
      }),
    );
    const epg = start();
    const loads = Array.from({ length: MAX_CONCURRENT }, (_, i) => epg.load(channel(i + 1)));
    await vi.waitFor(() => expect(requested).toHaveLength(6));
    // Round 2 after 5 s (not 5 s × 2⁵), round 3 after 10 s more, round 4 after 20 s more.
    let roundAt = Date.now();
    for (const [wait, total] of [
      [BACKOFF_INITIAL_MS, 12],
      [BACKOFF_INITIAL_MS * 2, 18],
      [BACKOFF_INITIAL_MS * 4, 24],
    ] as const) {
      await vi.advanceTimersByTimeAsync(roundAt + wait - 300 - Date.now());
      expect(requested).toHaveLength(total - 6);
      await vi.advanceTimersByTimeAsync(400);
      await vi.waitFor(() => expect(requested).toHaveLength(total));
      roundAt += wait;
    }
    await Promise.all(loads.map((l) => settled(l)));
  });

  it('a success sent before the latest 429 does not reset the backoff', async () => {
    // Request 1 is held; request 2 gets 429; then request 1 succeeds; request 2's retry gets 429
    // again: the backoff must have doubled (10 s), not restarted at 5 s.
    let release: (() => void) | undefined;
    let throttles = 0;
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, async ({ request }) => {
        const id = new URL(request.url).searchParams.get('stream_id');
        if (id === '1' && release === undefined) {
          await new Promise<void>((resolve) => {
            release = resolve;
            holds.push(resolve);
          });
          return HttpResponse.json({ epg_listings: [] });
        }
        if (id === '2' && throttles < 2) {
          throttles++;
          return new HttpResponse(null, { status: 429 });
        }
        return HttpResponse.json({ epg_listings: [] });
      }),
    );
    const epg = start();
    const one = epg.load(channel(1));
    const two = epg.load(channel(2));
    await vi.waitFor(() => expect(throttles).toBe(1));
    release?.();
    await settled(one);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS + 10);
    await vi.waitFor(() => expect(throttles).toBe(2));
    const sent = requested.length;
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS + 10);
    expect(requested).toHaveLength(sent);
    await vi.advanceTimersByTimeAsync(BACKOFF_INITIAL_MS);
    await settled(two);
    expect(requested).toHaveLength(sent + 1);
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

  it('a rejected login settles every queued and in-flight caller with "no EPG"', async () => {
    const release: (() => void)[] = [];
    server.use(
      http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, async () => {
        await new Promise<void>((resolve) => {
          release.push(resolve);
          holds.push(resolve);
        });
        return HttpResponse.json(xtreamFixtures.authFail);
      }),
    );
    const epg = start();
    const loads = Array.from({ length: 10 }, (_, i) => epg.load(channel(i + 1)));
    await vi.waitFor(() => expect(requested).toHaveLength(MAX_CONCURRENT));
    release[0]?.();
    const results = await Promise.all(loads.map((l) => settled(l)));
    expect(results.every((r) => r.length === 0)).toBe(true);
    expect(requested).toHaveLength(MAX_CONCURRENT);
    for (const r of release) r();
  });

  it('without a stored password it sends nothing', async () => {
    vault.get.mockResolvedValueOnce(undefined);
    const epg = start();
    expect(await settled(epg.load(channel(1001)))).toEqual([]);
    expect(requested).toEqual([]);
  });

  it('cancel() aborts what is in flight without caching it; the service stays usable', async () => {
    // A fetch double that only ends when aborted (first call) — independent of MSW timing.
    let calls = 0;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      calls++;
      if (calls > 1) return Promise.resolve(Response.json(xtreamFixtures.shortEpg));
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    service = createEpgService(source, { vault, fetchImpl });
    const epg = service as EpgService;
    const pending = epg.load(channel(1001));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    epg.cancel();
    expect(await pending).toEqual([]);
    expect(epg.peek(channel(1001))).toBeUndefined();
    expect((await settled(epg.load(channel(1001)))).length).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
