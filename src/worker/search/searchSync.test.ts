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
import { isM3uSourceSyncing, syncM3uSource } from '@/providers/m3u';
import { isSourceSyncing, syncXtreamSource } from '@/providers/xtream';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { tasks } from '../tasks';
import {
  resetSearchCacheForTests,
  searchCatalog,
  waitForSearchIndexIdle,
  warmUpSearch,
} from './searchService';

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

    await waitForSearchIndexIdle(id);
    const entry = await catalogRepo.getSearchIndex(id);
    expect(entry?.data).not.toContain(PASS);
    expect(entry?.data).not.toContain(USER);

    // Loaded from storage (not rebuilt) after a restart; prefix and fuzzy both work.
    resetSearchCacheForTests();
    const build = vi.spyOn(catalogRepo, 'listForSource');
    expect(await warmUpSearch(id)).toEqual({
      sourceId: id,
      from: 'storage',
      items: result.stats.live + result.stats.movies + result.stats.series,
    });
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

    await waitForSearchIndexIdle(id);
    const entry = await catalogRepo.getSearchIndex(id);
    expect(entry).toBeDefined();
    expect(entry?.data).not.toContain(PASS);
    expect(entry?.data).not.toContain('panel.example.test');

    resetSearchCacheForTests();
    expect((await names(id, 'noticias')).live).toEqual(['Notícias Exemplo']);
    expect((await names(id, 'synthetic movie')).movie).toEqual(['The Synthetic Movie (2024)']);
  });

  it('logs no credentials while syncing and indexing', async () => {
    await tasks.syncXtream({ sourceId: await seedXtream() }, ctx());
    await tasks.syncM3u({ sourceId: await seedM3u() }, ctx());
    await waitForSearchIndexIdle('xt');
    await waitForSearchIndexIdle('m3u');
    const logged = JSON.stringify(getLogEntries());
    expect(logged).toContain('search: index built');
    expect(logged).not.toContain(PASS);
  });

  it('a failed sync does not build an index', async () => {
    server.use(...xtreamHandlers({ auth: 'fail' }));
    const id = await seedXtream();
    await expect(tasks.syncXtream({ sourceId: id }, ctx())).rejects.toThrow();
    await waitForSearchIndexIdle(id);
    expect(await catalogRepo.getSearchIndex(id)).toBeUndefined();
  });

  it('a throwing hook does not fail the sync (both providers)', async () => {
    const afterSync = vi.fn((_sourceId: string) => {
      throw new Error('index failure');
    });
    const xt = await syncXtreamSource({ sourceId: await seedXtream() }, ctx(), { afterSync });
    expect(xt.status).toBe('ok');
    const m3u = await syncM3uSource({ sourceId: await seedM3u() }, ctx(), { afterSync });
    expect(m3u.status).toBe('ok');
    expect(afterSync.mock.calls.map((c) => c[0])).toEqual(['xt', 'm3u']);
  });

  it.each(['xtream', 'm3u'] as const)(
    '%s: the hook runs after "done" and once the source is released',
    async (kind) => {
      const id = kind === 'xtream' ? await seedXtream() : await seedM3u();
      const phases: string[] = [];
      const context = { ...ctx(), progress: (p: { phase: string }) => phases.push(p.phase) };
      const seen: Array<{ lastPhase?: string; syncing: boolean }> = [];
      const afterSync = vi.fn(() => {
        seen.push({
          lastPhase: phases.at(-1),
          syncing: kind === 'xtream' ? isSourceSyncing(id) : isM3uSourceSyncing(id),
        });
      });
      if (kind === 'xtream') await syncXtreamSource({ sourceId: id }, context, { afterSync });
      else await syncM3uSource({ sourceId: id }, context, { afterSync });
      expect(seen).toEqual([{ lastPhase: 'done', syncing: false }]);
    },
  );

  it('the sync does not wait for the index; a query meanwhile waits for that build', async () => {
    const id = await seedXtream();
    const build = vi.spyOn(catalogRepo, 'listForSource');
    await tasks.syncXtream({ sourceId: id }, ctx());
    // The build is queued, not finished: no index stored yet.
    expect(await catalogRepo.getSearchIndex(id)).toBeUndefined();
    expect((await names(id, 'drama')).series).toEqual(['Example Drama']);
    // One build (3 type reads): the query used the queued build instead of starting another.
    expect(build).toHaveBeenCalledTimes(3);
    expect(await catalogRepo.getSearchIndex(id)).toBeDefined();
  });
});
