// @vitest-environment node
// App data worker (composition root): registry, client wiring, `syncXtream` end to end through
// `createDataWorkerApi` + a real MessageChannel (FND-07 / SRC-07), and the background sync (AC5).
import { expose, wrap } from 'comlink';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import {
  catalogRepo,
  closeDatabase,
  openDatabase,
  settingsRepo,
  sourcesRepo,
  type Source,
} from '@/core/db';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { clearSecrets } from '@/core/log';
import {
  createDataWorkerApi,
  runTaskOn,
  WorkerTaskError,
  type DataWorkerApi,
  type DataWorkerRemote,
  type RunTaskOptions,
  type TaskProgress,
} from '@/core/worker';
import { isSourceSyncing, type SyncXtreamResult } from '@/providers/xtream';
import { isM3uSourceSyncing, type M3uSyncProgress, type SyncM3uResult } from '@/providers/m3u';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import {
  DEFAULT_SYNC_MAX_AGE_MS,
  getDataWorker,
  isSyncDue,
  runTask,
  startBackgroundSyncIfDue,
  terminateDataWorker,
} from './index';
import { tasks } from './tasks';

const openFreshDatabase = () => openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });

const ports: MessagePort[] = [];

function connect(): DataWorkerRemote {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  expose(createDataWorkerApi({ tasks }), port1);
  return wrap<DataWorkerApi>(port2);
}

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
  terminateDataWorker();
  vi.unstubAllGlobals();
  server.resetHandlers();
});

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 28, 12);

function source(id: string, extra: Partial<Source> = {}): Source {
  return {
    id,
    kind: 'xtream',
    name: id,
    serverUrl: XTREAM_TEST_BASE_URL,
    username: XTREAM_TEST_CREDENTIALS.username,
    secretRef: `xtream:${id}`,
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
    ...extra,
  };
}

describe('registry and client', () => {
  it('registers selfTest, syncXtream and syncM3u', () => {
    expect(Object.keys(tasks).sort()).toEqual([
      'selfTest',
      'syncM3u',
      'syncXtream',
      'waitSyncIdle',
    ]);
  });

  it('runs selfTest through the real registry', async () => {
    expect(await runTaskOn(connect(), 'selfTest', { steps: 3 })).toEqual({ steps: 3 });
  });

  it('lazily creates one module Worker named "data" from data.worker.ts', () => {
    const created: Array<{ url: string; options?: WorkerOptions }> = [];
    class FakeWorker extends EventTarget {
      constructor(url: URL | string, options?: WorkerOptions) {
        super();
        created.push(options ? { url: String(url), options } : { url: String(url) });
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    expect(getDataWorker()).toBe(getDataWorker());
    expect(created).toHaveLength(1);
    expect(created[0]?.url).toMatch(/data\.worker\.ts$/);
    expect(created[0]?.options).toMatchObject({ type: 'module', name: 'data' });
    // Typed client: a wrong input would not compile (checked by `npm run typecheck`).
    const pending = runTask('selfTest', { steps: 1 });
    terminateDataWorker();
    return expect(pending).rejects.toBeInstanceOf(WorkerTaskError);
  });
});

describe('syncXtream through the worker API (SRC-07)', () => {
  beforeEach(async () => {
    await openFreshDatabase();
    await sourcesRepo.put(source('w1'));
    await credentialVault.put('xtream:w1', XTREAM_TEST_CREDENTIALS.password);
  });
  afterEach(async () => {
    await closeDatabase();
    clearSecrets();
  });

  it('syncs, reports phased progress without secrets and returns a cloneable result', async () => {
    const seen: TaskProgress[] = [];
    const result = await runTaskOn<SyncXtreamResult>(
      connect(),
      'syncXtream',
      { sourceId: 'w1' },
      { onProgress: (p) => seen.push(p) },
    );
    expect(result).toMatchObject({
      sourceId: 'w1',
      status: 'ok',
      stats: { live: 6, movies: 4, series: 3 },
    });
    expect(seen.at(-1)).toEqual({ phase: 'done', done: 3, total: 3 });
    const serialized = JSON.stringify([seen, result]);
    expect(serialized).not.toContain(XTREAM_TEST_CREDENTIALS.password);
    expect(serialized).not.toContain(XTREAM_TEST_CREDENTIALS.username);
    expect(await catalogRepo.count('w1', 'movie')).toBe(4);
  });

  it('a failure arrives as WorkerTaskError with only the code', async () => {
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const err = await runTaskOn(connect(), 'syncXtream', { sourceId: 'w1' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorkerTaskError);
    expect((err as WorkerTaskError).message).toBe('Xtream sync failed (auth)');
  });

  it('client abort cancels the sync and keeps previous data', async () => {
    await runTaskOn(connect(), 'syncXtream', { sourceId: 'w1' });
    server.use(...xtreamHandlers({ delayMs: 300 }));
    const ctrl = new AbortController();
    const run = runTaskOn(
      connect(),
      'syncXtream',
      { sourceId: 'w1' },
      {
        signal: ctrl.signal,
        onProgress: (p) => {
          if (p.phase === 'live-categories') ctrl.abort();
        },
      },
    );
    const err = await run.catch((e: unknown) => e);
    expect((err as WorkerTaskError).kind).toBe('cancelled');
    // Let the worker side notice the cancellation and settle.
    await new Promise((r) => setTimeout(r, 400));
    expect(await catalogRepo.count('w1', 'live')).toBe(6);
  });
});

describe('syncM3u through the worker API (SRC-04/SRC-05)', () => {
  const GET_PHP = `${XTREAM_TEST_BASE_URL}/get.php?username=${XTREAM_TEST_CREDENTIALS.username}&password=${XTREAM_TEST_CREDENTIALS.password}&type=m3u_plus`;
  beforeEach(async () => {
    await openFreshDatabase();
    await sourcesRepo.put(
      source('m1', {
        kind: 'm3u-url',
        serverUrl: undefined,
        username: undefined,
        secretRef: 'source:m1:url',
      }),
    );
    await credentialVault.put('source:m1:url', GET_PHP);
  });
  afterEach(async () => {
    await closeDatabase();
    clearSecrets();
  });

  it('imports with bytes/entries progress; only the source id crosses the boundary', async () => {
    const seen: TaskProgress[] = [];
    const result = await runTaskOn<SyncM3uResult>(
      connect(),
      'syncM3u',
      { sourceId: 'm1' },
      { onProgress: (p) => seen.push(p) },
    );
    expect(result).toMatchObject({
      sourceId: 'm1',
      status: 'ok',
      stats: { live: 3, movies: 1, series: 1 },
    });
    const phases = new Set(seen.map((p) => p.phase as M3uSyncProgress['phase']));
    // The worker's progress throttle keeps only the latest message per 50 ms window, yet the final
    // download/parse totals are spaced so they reach the client before the write phase (review #7).
    // `write` itself is transient: a fast write can be superseded by `done` within one window.
    expect([...phases]).toEqual(expect.arrayContaining(['download', 'parse', 'done']));
    const writeAt = seen.findIndex((p) => p.phase === 'write' || p.phase === 'done');
    const beforeWrite = seen.slice(0, writeAt);
    expect(beforeWrite.filter((p) => p.phase === 'download').at(-1)?.done).toBe(result.bytes);
    expect(beforeWrite.filter((p) => p.phase === 'parse').at(-1)?.done).toBe(result.entries);
    expect(seen.at(-1)).toMatchObject({ phase: 'done' });
    const serialized = JSON.stringify([seen, result]);
    expect(serialized).not.toContain(XTREAM_TEST_CREDENTIALS.password);
    expect(serialized).not.toContain(XTREAM_TEST_CREDENTIALS.username);
  });

  it('an expected failure resolves with its code (not a rejection)', async () => {
    server.use(...xtreamHandlers({ error: 'html', errorOn: ['get.php'] }));
    const result = await runTaskOn<SyncM3uResult>(connect(), 'syncM3u', { sourceId: 'm1' });
    expect(result).toMatchObject({ status: 'error', error: 'not-m3u' });
  });

  it('waitSyncIdle also waits for M3U imports', async () => {
    const api = connect();
    const run = runTaskOn(api, 'syncM3u', { sourceId: 'm1' });
    await runTaskOn(api, 'waitSyncIdle', { sourceId: 'm1' });
    expect(isM3uSourceSyncing('m1')).toBe(false);
    await run;
  });
});

describe('isSyncDue (AC5)', () => {
  const xt = (lastSyncAt?: number) =>
    lastSyncAt === undefined
      ? { kind: 'xtream' as const }
      : { kind: 'xtream' as const, lastSyncAt };

  it.each([
    ['never synced', xt(), DEFAULT_SYNC_MAX_AGE_MS, true],
    ['synced 1 h ago', xt(NOW - HOUR), DEFAULT_SYNC_MAX_AGE_MS, false],
    ['synced just under 24 h ago', xt(NOW - 24 * HOUR + 1), DEFAULT_SYNC_MAX_AGE_MS, false],
    ['synced exactly 24 h ago', xt(NOW - 24 * HOUR), DEFAULT_SYNC_MAX_AGE_MS, true],
    ['synced 3 days ago', xt(NOW - 72 * HOUR), DEFAULT_SYNC_MAX_AGE_MS, true],
    ['custom max age 6 h, synced 7 h ago', xt(NOW - 7 * HOUR), 6 * HOUR, true],
    ['custom max age 6 h, synced 5 h ago', xt(NOW - 5 * HOUR), 6 * HOUR, false],
    ['lastSyncAt in the future (clock moved back)', xt(NOW + HOUR), DEFAULT_SYNC_MAX_AGE_MS, true],
    ['invalid max age falls back to 24 h', xt(NOW - HOUR), Number.NaN, false],
    ['zero max age falls back to 24 h', xt(NOW - HOUR), 0, false],
    [
      'm3u-file is never refreshed automatically',
      { kind: 'm3u-file' as const },
      DEFAULT_SYNC_MAX_AGE_MS,
      false,
    ],
    [
      'm3u-url is not handled by this sync',
      { kind: 'm3u-url' as const },
      DEFAULT_SYNC_MAX_AGE_MS,
      false,
    ],
  ])('%s → %s', (_label, src, maxAge, expected) => {
    expect(isSyncDue(src, NOW, maxAge)).toBe(expected);
  });

  it('defaults to 24 h', () => {
    expect(DEFAULT_SYNC_MAX_AGE_MS).toBe(24 * HOUR);
    expect(isSyncDue(xt(NOW - 25 * HOUR), NOW)).toBe(true);
  });
});

describe('startBackgroundSyncIfDue (AC5)', () => {
  beforeEach(async () => {
    await openFreshDatabase();
    await sourcesRepo.put(source('fresh', { createdAt: 1, lastSyncAt: NOW - HOUR }));
    await sourcesRepo.put(source('stale', { createdAt: 2, lastSyncAt: NOW - 30 * HOUR }));
    await sourcesRepo.put(source('never', { createdAt: 3 }));
    await sourcesRepo.put(source('file', { createdAt: 4, kind: 'm3u-file' }));
  });
  afterEach(async () => {
    await closeDatabase();
  });

  const okRun = vi.fn(async (sourceId: string) => ({
    sourceId,
    status: 'ok' as const,
    types: {},
    stats: { live: 0, movies: 0, series: 0 },
  }));

  it('starts due Xtream sources only, active source first, one at a time', async () => {
    await settingsRepo.set('activeSourceId', 'never');
    okRun.mockClear();
    const { started, done } = await startBackgroundSyncIfDue({
      now: NOW,
      run: okRun,
      isOnline: () => true,
    });
    expect(started).toEqual(['never', 'stale']);
    expect(await done).toEqual([
      { sourceId: 'never', status: 'ok' },
      { sourceId: 'stale', status: 'ok' },
    ]);
    expect(okRun.mock.calls.map((c) => c[0])).toEqual(['never', 'stale']);
  });

  it('does nothing when offline', async () => {
    okRun.mockClear();
    const { started } = await startBackgroundSyncIfDue({
      now: NOW,
      run: okRun,
      isOnline: () => false,
    });
    expect(started).toEqual([]);
    expect(okRun).not.toHaveBeenCalled();
  });

  it('honours a custom max age', async () => {
    const { started, done } = await startBackgroundSyncIfDue({
      now: NOW,
      maxAgeMs: 30 * 60 * 1000,
      run: okRun,
      isOnline: () => true,
    });
    await done;
    expect(started).toEqual(['fresh', 'stale', 'never']);
  });

  it('does not start a second sync for a source already in flight; failures never reject', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slowRun = vi.fn(async (sourceId: string) => {
      await gate;
      if (sourceId === 'stale') throw new WorkerTaskError('failed', 'x');
      throw new WorkerTaskError('cancelled');
    });
    const first = await startBackgroundSyncIfDue({ now: NOW, run: slowRun, isOnline: () => true });
    const second = await startBackgroundSyncIfDue({ now: NOW, run: slowRun, isOnline: () => true });
    expect(first.started).toEqual(['stale', 'never']);
    expect(second.started).toEqual([]);
    release();
    expect(await first.done).toEqual([
      { sourceId: 'stale', status: 'failed' },
      { sourceId: 'never', status: 'cancelled' },
    ]);
  });

  it('end to end with the real task (via an injected worker-API runner)', async () => {
    await credentialVault.put('xtream:stale', XTREAM_TEST_CREDENTIALS.password);
    await credentialVault.put('xtream:never', XTREAM_TEST_CREDENTIALS.password);
    const api = connect();
    const { done } = await startBackgroundSyncIfDue({
      now: NOW,
      isOnline: () => true,
      run: (sourceId, options) =>
        runTaskOn<SyncXtreamResult>(api, 'syncXtream', { sourceId }, options),
    });
    expect(await done).toEqual([
      { sourceId: 'stale', status: 'ok' },
      { sourceId: 'never', status: 'ok' },
    ]);
    expect((await sourcesRepo.get('never'))?.stats).toEqual({ live: 6, movies: 4, series: 3 });
    clearSecrets();
  });
});

describe('background + manual syncs of one source (review #3 and #5)', () => {
  beforeEach(async () => {
    await openFreshDatabase();
    await sourcesRepo.put(source('stale', { createdAt: 1, lastSyncAt: NOW - 30 * HOUR }));
    await sourcesRepo.put(source('never', { createdAt: 2 }));
    await credentialVault.put('xtream:stale', XTREAM_TEST_CREDENTIALS.password);
    await credentialVault.put('xtream:never', XTREAM_TEST_CREDENTIALS.password);
  });
  afterEach(async () => {
    server.events.removeAllListeners();
    await closeDatabase();
    clearSecrets();
  });

  const FULL = [
    'auth',
    'get_live_categories',
    'get_live_streams',
    'get_vod_categories',
    'get_vod_streams',
    'get_series_categories',
    'get_series',
  ];

  it('a manual sync and a background sync of the same source never interleave', async () => {
    const order: string[] = [];
    server.events.on('request:start', ({ request }) => {
      order.push(new URL(request.url).searchParams.get('action') ?? 'auth');
    });
    server.use(...xtreamHandlers({ delayMs: 5 }));
    const api = connect();
    const manual = runTaskOn<SyncXtreamResult>(api, 'syncXtream', { sourceId: 'stale' });
    const background = await startBackgroundSyncIfDue({
      now: NOW,
      isOnline: () => true,
      run: (sourceId, options) =>
        runTaskOn<SyncXtreamResult>(api, 'syncXtream', { sourceId }, options),
      waitIdle: (sourceId) => runTaskOn(api, 'waitSyncIdle', { sourceId }),
    });
    expect(background.started).toEqual(['stale', 'never']);
    expect((await manual).status).toBe('ok');
    expect(await background.done).toEqual([
      { sourceId: 'stale', status: 'ok' },
      { sourceId: 'never', status: 'ok' },
    ]);
    // Three complete, non-interleaved runs: manual (stale), background (stale), background (never).
    expect(order).toEqual([...FULL, ...FULL, ...FULL]);
    expect((await sourcesRepo.get('stale'))?.lastSyncByType?.series?.status).toBe('ok');
  });

  it('cancel + immediate restart: the source stays in flight until the worker has stopped', async () => {
    // The abort is triggered from a (throttled) progress message: keep every panel response slow
    // enough that the sync is still running when the abort lands, even on a loaded CI machine.
    server.use(...xtreamHandlers({ delayMs: 300 }));
    const api = connect();
    const waited: string[] = [];
    const options = (signal?: AbortSignal) => ({
      now: NOW,
      isOnline: () => true,
      run: (sourceId: string, opts: RunTaskOptions) =>
        runTaskOn<SyncXtreamResult>(api, 'syncXtream', { sourceId }, opts),
      waitIdle: async (sourceId: string) => {
        await runTaskOn(api, 'waitSyncIdle', { sourceId });
        // By now the worker-side task has settled.
        expect(isSourceSyncing(sourceId)).toBe(false);
        waited.push(sourceId);
      },
      ...(signal ? { signal } : {}),
    });

    const ctrl = new AbortController();
    const first = await startBackgroundSyncIfDue(options(ctrl.signal));
    expect(first.started).toEqual(['stale', 'never']);
    // Abort right after dispatch (not from a throttled progress message): with ~7 panel calls of
    // 300 ms each, the sync cannot finish before the abort lands, even on a loaded machine.
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 40));
    // The client already rejected, but the worker may still be stopping: no second run yet.
    const restart = await startBackgroundSyncIfDue(options());
    expect(restart.started).toEqual([]);

    expect(await first.done).toEqual([
      { sourceId: 'stale', status: 'cancelled' },
      { sourceId: 'never', status: 'cancelled' },
    ]);
    expect(waited).toEqual(['stale']);
    expect(isSourceSyncing('stale')).toBe(false);

    const again = await startBackgroundSyncIfDue(options());
    expect(again.started).toEqual(['stale', 'never']);
    expect((await again.done).map((o) => o.status)).toEqual(['ok', 'ok']);
  });
});
