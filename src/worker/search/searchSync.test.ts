// @vitest-environment node
// SCH-01 AC1: the index is rebuilt at the end of a successful sync of both providers — through
// the real task registry (`tasks.syncXtream` / `tasks.syncM3u`), the MSW fake panel (QA-01),
// fake-indexeddb and the real WebCrypto vault. No credentials end up in the index or the logs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, closeDatabase, openDatabase, sourcesRepo, type Source } from '@/core/db';
import { clearLogBuffer, clearSecrets, getLogEntries } from '@/core/log';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { syncM3uSource } from '@/providers/m3u';
import { syncXtreamSource } from '@/providers/xtream';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { tasks } from '../tasks';
import { resetSearchCacheForTests, searchCatalog } from './searchService';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const GET_PHP = `${XTREAM_TEST_BASE_URL}/get.php?username=${USER}&password=${PASS}&type=m3u_plus`;

function ctx(): TaskContext {
  return {
    progress: () => undefined,
    cancelled: false,
    throwIfCancelled() {
      if (this.cancelled) throw new WorkerTaskError('cancelled');
    },
  };
}

function base(id: string, kind: Source['kind']): Source {
  return {
    id,
    kind,
    name: id,
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'never',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

async function seedXtream(id = 'xt'): Promise<string> {
  await sourcesRepo.put({
    ...base(id, 'xtream'),
    serverUrl: XTREAM_TEST_BASE_URL,
    username: USER,
    secretRef: `xtream:${id}`,
  });
  await credentialVault.put(`xtream:${id}`, PASS);
  return id;
}

async function seedM3u(id = 'm3u'): Promise<string> {
  await sourcesRepo.put({ ...base(id, 'm3u-url'), secretRef: `source:${id}:url` });
  await credentialVault.put(`source:${id}:url`, GET_PHP);
  return id;
}

const names = async (sourceId: string, query: string) => {
  const r = await searchCatalog({ sourceId, query });
  return {
    live: r.groups.live.hits.map((h) => h.name),
    movie: r.groups.movie.hits.map((h) => h.name),
    series: r.groups.series.hits.map((h) => h.name),
  };
};

beforeEach(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  resetSearchCacheForTests();
  clearLogBuffer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  server.resetHandlers();
  await closeDatabase();
  clearSecrets();
});

describe('index built at the end of a sync', () => {
  it('Xtream: the task stores the index of the synced catalogue', async () => {
    const id = await seedXtream();
    const result = await tasks.syncXtream({ sourceId: id }, ctx());
    expect(result.status).toBe('ok');

    const entry = await catalogRepo.getSearchIndex(id);
    expect(entry?.items).toBe(result.stats.live + result.stats.movies + result.stats.series);
    expect(entry?.data).not.toContain(PASS);
    expect(entry?.data).not.toContain(USER);

    // Loaded from storage (not rebuilt) after a restart; prefix and fuzzy both work.
    resetSearchCacheForTests();
    const build = vi.spyOn(catalogRepo, 'listForSource');
    expect((await names(id, 'test sp')).live).toEqual(
      expect.arrayContaining(['Test Sports 1', 'Test Sports 2 (AC-3)']),
    );
    expect((await names(id, 'synthetc')).movie).toEqual(['The Synthetic Movie (2024)']);
    expect(build).not.toHaveBeenCalled();
  });

  it('M3U: the task stores the index of the imported list without the list credentials', async () => {
    const id = await seedM3u();
    const result = await tasks.syncM3u({ sourceId: id }, ctx());
    expect(result.status).toBe('ok');

    const entry = await catalogRepo.getSearchIndex(id);
    expect(entry?.items).toBeGreaterThan(0);
    expect(entry?.data).not.toContain(PASS);
    expect(entry?.data).not.toContain('panel.example.test');

    resetSearchCacheForTests();
    expect((await names(id, 'noticias')).live).toEqual(['Notícias Exemplo']);
    expect((await names(id, 'synthetic movie')).movie).toEqual(['The Synthetic Movie (2024)']);
  });

  it('logs no credentials while syncing and indexing', async () => {
    await tasks.syncXtream({ sourceId: await seedXtream() }, ctx());
    await tasks.syncM3u({ sourceId: await seedM3u() }, ctx());
    const logged = JSON.stringify(getLogEntries());
    expect(logged).toContain('search: index built');
    expect(logged).not.toContain(PASS);
  });

  it('a failed sync does not build an index', async () => {
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const id = await seedXtream();
    await expect(tasks.syncXtream({ sourceId: id }, ctx())).rejects.toThrow();
    expect(await catalogRepo.getSearchIndex(id)).toBeUndefined();
  });

  it('a failing hook does not fail the sync (both providers)', async () => {
    const afterSync = vi.fn().mockRejectedValue(new Error('index failure'));
    const xt = await syncXtreamSource({ sourceId: await seedXtream() }, ctx(), { afterSync });
    expect(xt.status).toBe('ok');
    const m3u = await syncM3uSource({ sourceId: await seedM3u() }, ctx(), { afterSync });
    expect(m3u.status).toBe('ok');
    expect(afterSync).toHaveBeenCalledTimes(2);
    expect(afterSync.mock.calls.map((c) => c[0])).toEqual(['xt', 'm3u']);
  });

  it('the hook runs while the source is still held (before a queued sync starts)', async () => {
    const id = await seedXtream();
    const order: string[] = [];
    const afterSync = vi.fn(async () => {
      order.push('hook:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('hook:end');
    });
    const first = syncXtreamSource({ sourceId: id }, ctx(), { afterSync });
    const second = syncXtreamSource({ sourceId: id }, ctx(), {
      afterSync: async () => {
        order.push('second');
      },
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['hook:start', 'hook:end', 'second']);
  });
});
