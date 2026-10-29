// @vitest-environment node
// SRC-07: Xtream catalogue sync end to end — MSW panel (QA-01) + fake-indexeddb + real WebCrypto
// vault. Node environment: real WebCrypto and structured clone of CryptoKey in fake-indexeddb.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  closeDatabase,
  openDatabase,
  favoritesRepo,
  historyRepo,
  itemKey,
  sourcesRepo,
  type ContentType,
  type Source,
} from '@/core/db';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import { WorkerTaskError, type TaskContext, type TaskProgress } from '@/core/worker';
import {
  XTREAM_TEST_BASE_URL,
  XTREAM_TEST_CREDENTIALS,
  xtreamHandlers,
  type XtreamVariant,
} from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import {
  credentialFreeUrl,
  isSourceSyncing,
  syncXtreamSource,
  waitForSourceIdle,
  type SyncXtreamDeps,
} from './sync';

const openFreshDatabase = () => openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const SOURCE_ID = 'src-1';
const SECRET_REF = `xtream:${SOURCE_ID}`;
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const NOW = Date.UTC(2026, 9, 28, 12);
const API = `${XTREAM_TEST_BASE_URL}/player_api.php`;

let db: Awaited<ReturnType<typeof openDatabase>>;

async function seedSource(extra: Partial<Source> = {}): Promise<void> {
  await sourcesRepo.put({
    id: SOURCE_ID,
    kind: 'xtream',
    name: 'Test panel',
    serverUrl: XTREAM_TEST_BASE_URL,
    username: USER,
    secretRef: SECRET_REF,
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  });
  await credentialVault.put(SECRET_REF, PASS);
}

beforeEach(async () => {
  db = await openFreshDatabase();
  await seedSource();
  clearLogBuffer();
});

afterEach(async () => {
  server.resetHandlers();
  await closeDatabase();
  clearSecrets();
});

interface FakeCtx {
  ctx: TaskContext;
  seen: TaskProgress[];
  cancel(): void;
}

/** TaskContext like the one api.ts builds; `onProgress` may cancel. */
function fakeCtx(onProgress?: (p: TaskProgress, cancel: () => void) => void): FakeCtx {
  let cancelled = false;
  const seen: TaskProgress[] = [];
  const cancel = () => {
    cancelled = true;
  };
  const ctx: TaskContext = {
    progress(p) {
      seen.push({ ...p });
      onProgress?.(p, cancel);
    },
    get cancelled() {
      return cancelled;
    },
    throwIfCancelled() {
      if (cancelled) throw new WorkerTaskError('cancelled');
    },
  };
  return { ctx, seen, cancel };
}

const deps: SyncXtreamDeps = { now: () => NOW, cancelPollMs: 5 };

function sync(ctx = fakeCtx().ctx, types?: ContentType[]) {
  return syncXtreamSource(
    types ? { sourceId: SOURCE_ID, types } : { sourceId: SOURCE_ID },
    ctx,
    deps,
  );
}

async function rejection(p: Promise<unknown>): Promise<WorkerTaskError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WorkerTaskError);
  return err as WorkerTaskError;
}

async function names(type: ContentType): Promise<string[]> {
  const cats = await catalogRepo.listCategories(SOURCE_ID, type);
  const out: string[] = [];
  for (const c of cats) {
    for (const item of await catalogRepo.listByCategory(type, c.key)) out.push(item.name);
  }
  return out;
}

/** Every stored row of every table, serialized. */
async function dumpAllTables(): Promise<string> {
  const parts: string[] = [];
  for (const table of db.tables) {
    if (table.name === 'secrets' || table.name === 'keys') continue;
    parts.push(JSON.stringify(await table.toArray()));
  }
  return parts.join('\n');
}

/** Inline override for one `player_api.php` action (falls through for the others). */
function onAction(action: string, respond: () => Response | Promise<Response>) {
  return http.get(API, ({ request }) => {
    if (new URL(request.url).searchParams.get('action') === action) return respond();
    return undefined;
  });
}

const EXPECTED: Record<
  XtreamVariant,
  { live: number; movies: number; series: number; skipped: Record<ContentType, number> }
> = {
  A: { live: 6, movies: 4, series: 3, skipped: { live: 0, movie: 0, series: 0 } },
  B: { live: 6, movies: 4, series: 3, skipped: { live: 0, movie: 0, series: 0 } },
  // Variant C has one live category with an empty id/name.
  C: { live: 6, movies: 4, series: 3, skipped: { live: 1, movie: 0, series: 0 } },
};

describe('syncXtreamSource — panel variants (AC1)', () => {
  it.each(['A', 'B', 'C'] as const)(
    'variant %s: writes categories and items of every type',
    async (variant) => {
      server.use(...xtreamHandlers({ variant }));
      const { ctx, seen } = fakeCtx();
      const result = await sync(ctx);
      const exp = EXPECTED[variant];

      expect(result.status).toBe('ok');
      expect(result.stats).toEqual({ live: exp.live, movies: exp.movies, series: exp.series });
      for (const t of ['live', 'movie', 'series'] as const) {
        expect(result.types[t]).toMatchObject({ status: 'ok', skipped: exp.skipped[t] });
      }

      // Categories keep the panel's order; items are reachable through their category.
      expect((await catalogRepo.listCategories(SOURCE_ID, 'live')).map((c) => c.name)).toEqual([
        'News',
        'Sports',
        'Kids & Família',
      ]);
      expect(
        (await catalogRepo.listCategories(SOURCE_ID, 'movie')).map((c) => c.externalId),
      ).toEqual(['10', '11']);
      expect(await names('live')).toEqual([
        'Example News HD',
        'Notícias Exemplo',
        'Test Sports 1',
        'Test Sports 2 (AC-3)',
        'Demo Kids',
        'Canal Ação, Aventura & Mais',
      ]);

      const news = await catalogRepo.get('live', itemKey(SOURCE_ID, 'live', 1001));
      expect(news).toMatchObject({
        name: 'Example News HD',
        nameNorm: 'example news hd',
        streamPath: '1001',
        epgId: 'news.example.test',
        logo: 'http://img.example.test/logos/1001.png',
        catchup: { days: 3 },
        categoryKey: `${SOURCE_ID}:live:cat:1`,
      });
      const movie = await catalogRepo.get('movie', itemKey(SOURCE_ID, 'movie', 2002));
      expect(movie).toMatchObject({ ext: 'mkv', streamPath: '2002.mkv', rating: 6.4 });
      const series = await catalogRepo.get('series', itemKey(SOURCE_ID, 'series', 3001));
      expect(series).toMatchObject({
        name: 'Example Drama',
        rating: 8.2,
        categoryKey: `${SOURCE_ID}:series:cat:20`,
      });

      const source = await sourcesRepo.get(SOURCE_ID);
      expect(source).toMatchObject({
        lastSyncAt: NOW,
        lastSyncStatus: 'ok',
        stats: { live: exp.live, movies: exp.movies, series: exp.series },
      });
      expect(source?.lastSyncError).toBeUndefined();
      expect(source?.lastSyncByType?.series).toMatchObject({
        status: 'ok',
        at: NOW,
        lastOkAt: NOW,
      });

      // Phases in order, ending with `done`.
      const phases = [...new Set(seen.map((p) => p.phase))];
      expect(phases).toEqual([
        'auth',
        'live-categories',
        'live',
        'movie-categories',
        'movie',
        'series-categories',
        'series',
        'done',
      ]);
      expect(seen.at(-1)).toEqual({ phase: 'done', done: 3, total: 3 });
    },
  );

  it('syncs only the requested types', async () => {
    const result = await sync(undefined, ['movie']);
    expect(Object.keys(result.types)).toEqual(['movie']);
    expect(result.stats).toEqual({ live: 0, movies: 4, series: 0 });
    expect((await sourcesRepo.get(SOURCE_ID))?.lastSyncStatus).toBe('ok');
  });

  it('rejects a missing source, a non-Xtream source and a source without credentials', async () => {
    const missing = await rejection(syncXtreamSource({ sourceId: 'nope' }, fakeCtx().ctx, deps));
    expect(missing.message).toBe('Xtream sync: source not found');
    await seedSource({ kind: 'm3u-url' });
    expect((await rejection(sync())).message).toBe('Xtream sync: not an Xtream source');
    await seedSource({ secretRef: undefined });
    expect((await rejection(sync())).message).toBe('Xtream sync: source has no credentials');
    expect((await rejection(sync(undefined, []))).message).toBe('Xtream sync: no content types');
  });

  it('a missing vault secret fails with credentials-lost', async () => {
    await credentialVault.delete(SECRET_REF);
    expect((await rejection(sync())).message).toBe('Xtream sync failed (credentials-lost)');
    expect(await sourcesRepo.get(SOURCE_ID)).toMatchObject({
      lastSyncStatus: 'error',
      lastSyncError: 'credentials-lost',
    });
  });
});

describe('syncXtreamSource — invalid items (AC2)', () => {
  it('skips and counts invalid items and categories, writes the rest', async () => {
    server.use(
      onAction('get_live_categories', () =>
        HttpResponse.json([
          { category_id: '1', category_name: 'One' },
          { category_id: '', category_name: 'No id' },
          { category_id: '2' },
          'not an object',
          null,
        ]),
      ),
      onAction('get_live_streams', () =>
        HttpResponse.json([
          { stream_id: 1, name: 'Valid one', category_id: '1' },
          { name: 'No id' },
          { stream_id: 'abc', name: 'Bad id' },
          { stream_id: -5, name: 'Negative id' },
          { stream_id: 2, name: '   ' },
          { stream_id: 3 },
          42,
          null,
          ['array'],
          { stream_id: '4', name: 'Valid two', stream_icon: 'javascript:alert(1)', num: 'x' },
        ]),
      ),
    );
    const result = await sync(undefined, ['live']);
    // 'Valid two' has no category: it goes to the synthetic "uncategorized" one (VOD-01 review).
    expect(result.types.live).toMatchObject({ status: 'ok', items: 2, categories: 2, skipped: 12 });
    const two = await catalogRepo.get('live', itemKey(SOURCE_ID, 'live', 4));
    expect(two).toMatchObject({
      name: 'Valid two',
      categoryKey: `${SOURCE_ID}:live:cat:uncategorized`,
    });
    expect(two?.logo).toBeUndefined();
    expect(two?.number).toBeUndefined();
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(2);
  });

  it('a list where every entry is invalid is an invalid response (keeps old data)', async () => {
    await sync();
    server.use(onAction('get_vod_streams', () => HttpResponse.json([{ foo: 1 }, null])));
    const result = await sync();
    expect(result.status).toBe('partial');
    expect(result.types.movie).toMatchObject({ status: 'error', error: 'invalid-response' });
    expect(await catalogRepo.count(SOURCE_ID, 'movie')).toBe(4);
  });

  it('a non-array body is an invalid response (keeps old data)', async () => {
    await sync();
    server.use(onAction('get_series', () => HttpResponse.json({ error: 'nope' })));
    const result = await sync();
    expect(result.types.series).toMatchObject({ status: 'error', error: 'invalid-response' });
    expect(result.stats).toEqual({ live: 6, movies: 4, series: 3 });
  });
});

describe('syncXtreamSource — empty lists (review #2)', () => {
  it('[] for a type that has stored items is suspicious: empty-response, old data kept', async () => {
    await sync();
    server.use(onAction('get_vod_streams', () => HttpResponse.json([])));
    const result = await sync();
    expect(result.status).toBe('partial');
    expect(result.types.movie).toMatchObject({ status: 'error', error: 'empty-response' });
    expect(result.stats).toEqual({ live: 6, movies: 4, series: 3 });
    expect((await sourcesRepo.get(SOURCE_ID))?.lastSyncError).toBe('empty-response');
  });

  it('[] is accepted on a first sync (nothing stored before)', async () => {
    server.use(onAction('get_vod_streams', () => HttpResponse.json([])));
    const result = await sync();
    expect(result.status).toBe('ok');
    expect(result.types.movie).toMatchObject({ status: 'ok', items: 0, categories: 2 });
  });

  it('[] items with [] categories (both 200) empties the type: the section is gone', async () => {
    await sync();
    server.use(
      onAction('get_vod_streams', () => HttpResponse.json([])),
      onAction('get_vod_categories', () => HttpResponse.json([])),
    );
    const result = await sync();
    expect(result.types.movie).toMatchObject({ status: 'ok', items: 0, categories: 0 });
    expect(result.stats).toEqual({ live: 6, movies: 0, series: 3 });
    expect(await catalogRepo.listCategories(SOURCE_ID, 'movie')).toEqual([]);
  });

  it('[] categories with items still writes the items', async () => {
    await sync();
    server.use(onAction('get_vod_categories', () => HttpResponse.json([])));
    const result = await sync();
    // Every movie lands in the synthetic "uncategorized" category, so "All" still lists them.
    expect(result.types.movie).toMatchObject({ status: 'ok', items: 4, categories: 1 });
    const [only] = await catalogRepo.listCategories(SOURCE_ID, 'movie');
    expect(only).toMatchObject({ externalId: 'uncategorized', name: '' });
    expect(await catalogRepo.countByCategory('movie', only?.key ?? '')).toBe(4);
  });
});

describe('syncXtreamSource — source removed during the sync (review #1)', () => {
  it.each(['get_live_streams', 'get_vod_streams'])(
    'removing the source while %s is downloading leaves no orphan rows',
    async (action) => {
      await sync();
      server.use(
        onAction(action, async () => {
          await sourcesRepo.remove(SOURCE_ID);
          return HttpResponse.json([{ stream_id: 1, name: 'Late' }]);
        }),
      );
      const err = await rejection(sync());
      expect(err.kind).toBe('cancelled');
      expect(err.message).toBe('Xtream sync stopped (source-removed)');
      expect(await sourcesRepo.get(SOURCE_ID)).toBeUndefined();
      for (const t of ['live', 'movie', 'series'] as const) {
        expect(await catalogRepo.count(SOURCE_ID, t)).toBe(0);
        expect(await catalogRepo.listCategories(SOURCE_ID, t)).toEqual([]);
      }
      expect(await db.channels.count()).toBe(0);
      expect(await db.movies.count()).toBe(0);
      expect(await db.categories.count()).toBe(0);
    },
  );

  it('removing the source after the last write does not resurrect the source row', async () => {
    const { ctx } = fakeCtx((p) => {
      if (p.phase === 'series' && p.total !== undefined) void sourcesRepo.remove(SOURCE_ID);
    });
    const err = await rejection(sync(ctx));
    expect(err.message).toBe('Xtream sync stopped (source-removed)');
    expect(await sourcesRepo.get(SOURCE_ID)).toBeUndefined();
    expect(await db.series.count()).toBe(0);
    expect(await db.channels.count()).toBe(0);
  });
});

describe('syncXtreamSource — concurrent syncs of one source (review #3)', () => {
  const slowLiveStreams = () =>
    onAction('get_live_streams', async () => {
      await new Promise((r) => setTimeout(r, 80));
      return HttpResponse.json([{ stream_id: 1, name: 'Slow' }]);
    });

  it('the second sync waits for the first; per-type statuses merge', async () => {
    const order: string[] = [];
    server.events.on('request:start', ({ request }) => {
      order.push(new URL(request.url).searchParams.get('action') ?? 'auth');
    });
    server.use(slowLiveStreams());
    const [a, b] = await Promise.all([sync(undefined, ['live']), sync(undefined, ['movie'])]);
    server.events.removeAllListeners();
    expect(Object.keys(a.types)).toEqual(['live']);
    expect(Object.keys(b.types)).toEqual(['movie']);
    // No interleaving: the second run authenticates only after the first fetched its items.
    expect(order).toEqual([
      'auth',
      'get_live_categories',
      'get_live_streams',
      'auth',
      'get_vod_categories',
      'get_vod_streams',
    ]);
    const byType = (await sourcesRepo.get(SOURCE_ID))?.lastSyncByType;
    expect(byType?.live).toMatchObject({ status: 'ok', items: 1 });
    expect(byType?.movie).toMatchObject({ status: 'ok', items: 4 });
    expect(isSourceSyncing(SOURCE_ID)).toBe(false);
  });

  it('only types attempted by a run are overwritten in lastSyncByType', async () => {
    await sync();
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_series'] }));
    await sync(undefined, ['series']);
    const byType = (await sourcesRepo.get(SOURCE_ID))?.lastSyncByType;
    expect(byType?.live).toMatchObject({ status: 'ok' });
    expect(byType?.movie).toMatchObject({ status: 'ok' });
    expect(byType?.series).toMatchObject({ status: 'error', error: 'http' });
  });

  it('a queued sync can be cancelled while waiting and does not block the queue', async () => {
    server.use(slowLiveStreams());
    const first = sync(undefined, ['live']);
    const waiting = fakeCtx();
    const second = sync(waiting.ctx, ['movie']);
    const third = sync(undefined, ['series']);
    setTimeout(() => waiting.cancel(), 10);
    expect((await rejection(second)).kind).toBe('cancelled');
    expect(isSourceSyncing(SOURCE_ID)).toBe(true);
    expect((await first).status).toBe('ok');
    expect((await third).status).toBe('ok');
    await waitForSourceIdle(SOURCE_ID);
    expect(isSourceSyncing(SOURCE_ID)).toBe(false);
  });
});

describe('syncXtreamSource — unreachable server after auth (review #6)', () => {
  // Only setTimeout is faked (the request timeouts); IndexedDB (setImmediate), WebCrypto and the
  // cancellation poll (setInterval) keep running in real time.
  const realTick = () => new Promise<void>((resolve) => setImmediate(resolve));
  /** Lets real async work progress (and fake time creep by 1 ms per step) until `cond` holds. */
  async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 2_000 && !cond(); i++) {
      await realTick();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(cond()).toBe(true);
  }
  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 50; i++) await realTick();
  }

  let requested: string[] = [];
  beforeEach(() => {
    requested = [];
    server.events.on('request:start', ({ request }) => {
      requested.push(new URL(request.url).searchParams.get('action') ?? 'auth');
    });
  });
  afterEach(() => {
    server.events.removeAllListeners();
    vi.useRealTimers();
  });

  it('a categories call times out after 30 s; the remaining types are not attempted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(...xtreamHandlers({ error: 'timeout', errorOn: ['get_live_categories'] }));
    let settled = false;
    const run = sync().finally(() => (settled = true));
    await until(() => requested.includes('get_live_categories'));
    await advance(29_000);
    expect(settled).toBe(false);
    await advance(1_500);
    await until(() => settled);
    const result = await run;

    expect(result.status).toBe('error');
    expect(result.types.live).toMatchObject({ status: 'error', error: 'timeout' });
    expect(result.types.movie).toMatchObject({ status: 'error', error: 'server-unreachable' });
    expect(result.types.series).toMatchObject({ status: 'error', error: 'server-unreachable' });
    expect(requested).toEqual(['auth', 'get_live_categories']);
  });

  it('an items call gets 120 s; once it times out, later types are skipped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(...xtreamHandlers({ error: 'timeout', errorOn: ['get_vod_streams'] }));
    let settled = false;
    const run = sync().finally(() => (settled = true));
    await until(() => requested.includes('get_vod_streams'));
    await advance(60_000);
    expect(settled).toBe(false);
    await advance(61_000);
    await until(() => settled);
    const result = await run;
    expect(result.status).toBe('partial');
    expect(result.types.live).toMatchObject({ status: 'ok' });
    expect(result.types.movie).toMatchObject({ status: 'error', error: 'timeout' });
    expect(result.types.series).toMatchObject({ status: 'error', error: 'server-unreachable' });
    expect(requested).not.toContain('get_series_categories');
  });

  it('a network block mid-sync stops the remaining types too', async () => {
    server.use(...xtreamHandlers({ error: 'network', errorOn: ['get_live_streams'] }));
    const result = await sync();
    expect(result.types.live).toMatchObject({ status: 'error', error: 'blocked' });
    expect(result.types.movie).toMatchObject({ error: 'server-unreachable' });
    expect(requested).not.toContain('get_vod_categories');
  });
});

describe('syncXtreamSource — re-sync (AC3)', () => {
  it('keeps favorites and history and the same keys', async () => {
    await sync();
    const liveKey = itemKey(SOURCE_ID, 'live', 1001);
    const movieKey = itemKey(SOURCE_ID, 'movie', 2001);
    const seriesKey = itemKey(SOURCE_ID, 'series', 3002);
    await favoritesRepo.add(liveKey, 10);
    await favoritesRepo.add(seriesKey, 11);
    await historyRepo.upsert({ itemKey: movieKey, positionSec: 120, lastWatchedAt: 12 });

    server.use(...xtreamHandlers({ variant: 'B' }));
    await sync();

    expect(await favoritesRepo.has(liveKey)).toBe(true);
    expect(await favoritesRepo.has(seriesKey)).toBe(true);
    expect(await historyRepo.get(movieKey)).toMatchObject({ positionSec: 120 });
    expect(await catalogRepo.getMany('live', [liveKey])).toHaveLength(1);
    expect(await catalogRepo.getMany('movie', [movieKey])).toHaveLength(1);
    expect(await catalogRepo.getMany('series', [seriesKey])).toHaveLength(1);
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(6);
  });

  it('items removed by the panel disappear; the rest keep their keys', async () => {
    await sync();
    server.use(
      onAction('get_live_streams', () =>
        HttpResponse.json([{ stream_id: 1003, name: 'Test Sports 1', category_id: '2' }]),
      ),
    );
    await sync();
    expect(await names('live')).toEqual(['Test Sports 1']);
    expect(await catalogRepo.get('live', itemKey(SOURCE_ID, 'live', 1003))).toBeDefined();
  });
});

describe('syncXtreamSource — cancellation (AC4)', () => {
  beforeEach(async () => {
    await sync();
    // Second sync returns different data, so old vs new is observable.
    server.use(
      onAction('get_live_streams', () => HttpResponse.json([{ stream_id: 9, name: 'New live' }])),
      onAction('get_vod_streams', () => HttpResponse.json([{ stream_id: 8, name: 'New movie' }])),
      onAction('get_series', () => HttpResponse.json([{ series_id: 7, name: 'New series' }])),
    );
  });

  it('cancelling before a write keeps the previous data of that type and later types', async () => {
    // `movie` progress with a total is emitted right before the write.
    const { ctx } = fakeCtx((p, cancel) => {
      if (p.phase === 'movie' && p.total !== undefined) cancel();
    });
    expect((await rejection(sync(ctx))).kind).toBe('cancelled');

    // live was committed before the cancellation; movie/series untouched.
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(1);
    expect(await catalogRepo.count(SOURCE_ID, 'movie')).toBe(4);
    expect(await catalogRepo.count(SOURCE_ID, 'series')).toBe(3);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.stats).toEqual({ live: 1, movies: 4, series: 3 });
    // The overall status of the previous (complete) sync is kept.
    expect(source?.lastSyncStatus).toBe('ok');
  });

  it('cancelling during an in-flight request aborts it and keeps the previous data', async () => {
    server.use(
      onAction('get_live_streams', async () => {
        await new Promise((r) => setTimeout(r, 2_000));
        return HttpResponse.json([{ stream_id: 9, name: 'Too late' }]);
      }),
    );
    const { ctx } = fakeCtx((p, cancel) => {
      if (p.phase === 'live' && p.done === 0 && p.total === undefined) setTimeout(cancel, 20);
    });
    const start = Date.now();
    expect((await rejection(sync(ctx))).kind).toBe('cancelled');
    expect(Date.now() - start).toBeLessThan(1_000);
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(6);
    expect(await catalogRepo.count(SOURCE_ID, 'movie')).toBe(4);
  });

  it('cancelling before starting does nothing', async () => {
    const { ctx, cancel } = fakeCtx();
    cancel();
    expect((await rejection(sync(ctx))).kind).toBe('cancelled');
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(6);
  });
});

describe('syncXtreamSource — per-type failures (AC6)', () => {
  it('series 500: live and movies written, series keeps old data, error recorded per type', async () => {
    await sync();
    server.use(
      onAction('get_live_streams', () => HttpResponse.json([{ stream_id: 9, name: 'New live' }])),
      ...xtreamHandlers({ error: 'http-500', errorOn: ['get_series'] }),
    );
    const result = await sync();

    expect(result.status).toBe('partial');
    expect(result.types.live).toMatchObject({ status: 'ok', items: 1 });
    expect(result.types.movie).toMatchObject({ status: 'ok', items: 4 });
    expect(result.types.series).toMatchObject({ status: 'error', error: 'http', httpStatus: 500 });
    expect(result.stats).toEqual({ live: 1, movies: 4, series: 3 });

    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({
      lastSyncStatus: 'partial',
      lastSyncError: 'http',
      lastSyncAt: NOW,
      stats: { live: 1, movies: 4, series: 3 },
    });
    // The failed type remembers when it last succeeded.
    expect(source?.lastSyncByType?.series).toMatchObject({
      status: 'error',
      error: 'http',
      httpStatus: 500,
      lastOkAt: NOW,
    });
  });

  it('every type failing → status error, lastSyncAt unchanged', async () => {
    server.use(
      ...xtreamHandlers({
        error: 'html',
        errorOn: ['get_live_categories', 'get_vod_categories', 'get_series_categories'],
      }),
    );
    const result = await sync();
    expect(result.status).toBe('error');
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.lastSyncStatus).toBe('error');
    expect(source?.lastSyncAt).toBeUndefined();
    expect(source?.lastSyncError).toBe('parse');
  });

  it('a later successful sync clears lastSyncError', async () => {
    server.use(...xtreamHandlers({ error: 'http-500', errorOn: ['get_series'] }));
    await sync();
    server.resetHandlers();
    await sync();
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source?.lastSyncStatus).toBe('ok');
    expect(source?.lastSyncError).toBeUndefined();
  });
});

describe('syncXtreamSource — auth failures abort the whole sync', () => {
  it.each([
    ['fail', 'auth'],
    ['expired', 'account-inactive'],
    ['banned', 'account-inactive'],
  ] as const)('auth %s → %s, previous data intact', async (auth, code) => {
    await sync();
    server.use(...xtreamHandlers({ auth }));
    const err = await rejection(sync());
    expect(err.kind).toBe('failed');
    expect(err.message).toBe(`Xtream sync failed (${code})`);
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(6);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({ lastSyncStatus: 'error', lastSyncError: code });
    for (const t of ['live', 'movie', 'series'] as const) {
      expect(source?.lastSyncByType?.[t]).toMatchObject({
        status: 'error',
        error: code,
        lastOkAt: NOW,
      });
    }
  });

  it('a 401 after live was written: rejects, status error, lastSyncAt not advanced (review #4)', async () => {
    await seedSource({ lastSyncAt: 123, lastSyncStatus: 'ok' });
    server.use(...xtreamHandlers({ error: 'http-401', errorOn: ['get_vod_categories'] }));
    const requested: string[] = [];
    server.events.on('request:start', ({ request }) => {
      requested.push(new URL(request.url).searchParams.get('action') ?? 'auth');
    });
    const err = await rejection(sync());
    server.events.removeAllListeners();
    expect(err.kind).toBe('failed');
    expect(err.message).toBe('Xtream sync failed (auth)');
    expect(requested).not.toContain('get_series_categories');
    expect(await catalogRepo.count(SOURCE_ID, 'live')).toBe(6);
    const source = await sourcesRepo.get(SOURCE_ID);
    expect(source).toMatchObject({
      lastSyncStatus: 'error',
      lastSyncError: 'auth',
      lastSyncAt: 123,
      stats: { live: 6, movies: 0, series: 0 },
    });
    expect(source?.lastSyncByType?.live).toMatchObject({ status: 'ok', items: 6 });
    expect(source?.lastSyncByType?.movie).toMatchObject({ status: 'error', error: 'auth' });
    expect(source?.lastSyncByType?.series).toMatchObject({ status: 'error', error: 'auth' });
  });

  it('network failure during auth → blocked', async () => {
    server.use(...xtreamHandlers({ error: 'network', errorOn: ['auth'] }));
    expect((await rejection(sync())).message).toBe('Xtream sync failed (blocked)');
  });
});

describe('syncXtreamSource — credentials never leak', () => {
  it('no stored row, log entry or progress message contains the password or credential URLs', async () => {
    server.use(
      onAction('get_live_streams', () =>
        HttpResponse.json([
          {
            stream_id: 1,
            name: 'Leaky',
            stream_icon: `${XTREAM_TEST_BASE_URL}/images/x.png?username=${USER}&password=${PASS}`,
          },
          {
            stream_id: 2,
            name: 'Leaky path',
            stream_icon: `${XTREAM_TEST_BASE_URL}/live/${USER}/${PASS}/2.png`,
          },
          {
            stream_id: 3,
            name: 'Userinfo',
            stream_icon: `http://${USER}:${PASS}@img.example.test/3.png`,
          },
        ]),
      ),
      ...xtreamHandlers({ error: 'http-500', errorOn: ['get_series'] }),
    );
    const { ctx, seen } = fakeCtx();
    await sync(ctx);

    const rows = await dumpAllTables();
    expect(rows).not.toContain(PASS);
    expect(rows).not.toContain('password=');
    expect(rows).not.toContain('player_api.php');
    // The username is only on the source row (ARCHITECTURE.md §5), never in catalogue rows.
    const catalogue = JSON.stringify([
      await db.channels.toArray(),
      await db.movies.toArray(),
      await db.series.toArray(),
      await db.categories.toArray(),
    ]);
    expect(catalogue).not.toContain(USER);
    expect((await catalogRepo.get('live', itemKey(SOURCE_ID, 'live', 1)))?.logo).toBeUndefined();

    const logs = JSON.stringify(getLogEntries());
    expect(logs).not.toContain(PASS);
    expect(logs).not.toContain(USER);
    expect(JSON.stringify(seen)).not.toMatch(new RegExp(`${PASS}|${USER}|http`));
    // Sync failure messages are fixed strings with a code.
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const err = await rejection(sync());
    expect(err.message).not.toContain(PASS);
  });

  it('credentialFreeUrl', () => {
    const ok = credentialFreeUrl('jdoe', 's3cret!');
    expect(ok('http://img.example.test/a.png')).toBe(true);
    expect(ok('http://img.example.test/a.png?token=abc')).toBe(false);
    expect(ok('http://img.example.test/a.png?x=1&password=y')).toBe(false);
    expect(ok('http://img.example.test/s3cret%21/a.png')).toBe(false);
    expect(ok('http://img.example.test/jdoe/s3cret!/a.png')).toBe(false);
    // Very short passwords are only matched as a /user/pass/ path to avoid false positives.
    const short = credentialFreeUrl('u', 'p');
    expect(short('http://img.example.test/pp.png')).toBe(true);
    expect(short('http://img.example.test/u/p/1.png')).toBe(false);
  });
});
