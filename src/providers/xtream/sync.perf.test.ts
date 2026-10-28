// @vitest-environment node
// SRC-07 risk "JSON of tens of MB": sync of a generated 50,000-item VOD list (Node, MSW,
// fake-indexeddb). Reports wall time and a rough heap peak; asserts only generous upper bounds so
// it does not flake on slow CI machines. Numbers are indicative (Node + fake-indexeddb, not a
// browser on a weak device).
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, closeDatabase, openDatabase, sourcesRepo } from '@/core/db';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { syncXtreamSource } from './sync';

const openFreshDatabase = () => openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });

const COUNT = 50_000;
const CATEGORIES = 40;

/** Deterministic synthetic VOD list shaped like a real panel's `get_vod_streams`. */
function generateVodStreams(count: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const id = 100_000 + i;
    out.push({
      num: i + 1,
      name: `Synthetic Movie ${i} (${1980 + (i % 45)})`,
      stream_type: 'movie',
      stream_id: i % 2 === 0 ? id : String(id),
      stream_icon: `http://img.example.test/posters/${id}.jpg`,
      rating: i % 3 === 0 ? String((i % 100) / 10) : (i % 100) / 10,
      rating_5based: (i % 50) / 10,
      added: String(1_700_000_000 + i),
      is_adult: 0,
      category_id: String(1 + (i % CATEGORIES)),
      category_ids: [1 + (i % CATEGORIES)],
      container_extension: i % 4 === 0 ? 'mkv' : 'mp4',
      custom_sid: '',
      direct_source: '',
    });
  }
  return out;
}

const server = createMswServer(...xtreamHandlers());
let body = '';

beforeAll(() => {
  body = JSON.stringify(generateVodStreams(COUNT));
  const categories = JSON.stringify(
    Array.from({ length: CATEGORIES }, (_, i) => ({
      category_id: String(i + 1),
      category_name: `Category ${i + 1}`,
      parent_id: 0,
    })),
  );
  server.use(
    http.get(`${XTREAM_TEST_BASE_URL}/player_api.php`, ({ request }) => {
      const action = new URL(request.url).searchParams.get('action');
      const json = { 'Content-Type': 'application/json' };
      if (action === 'get_vod_streams') return new HttpResponse(body, { headers: json });
      if (action === 'get_vod_categories') return new HttpResponse(categories, { headers: json });
      return undefined;
    }),
  );
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(async () => {
  server.close();
  await closeDatabase();
});

const ctx: TaskContext = {
  progress: () => {},
  cancelled: false,
  throwIfCancelled: () => {
    if (ctx.cancelled) throw new WorkerTaskError('cancelled');
  },
};

describe('syncXtreamSource — 50k VOD (perf)', () => {
  it('syncs 50,000 movies and reports time and heap', { timeout: 120_000 }, async () => {
    await openFreshDatabase();
    await sourcesRepo.put({
      id: 'perf',
      kind: 'xtream',
      name: 'Perf',
      serverUrl: XTREAM_TEST_BASE_URL,
      username: XTREAM_TEST_CREDENTIALS.username,
      secretRef: 'xtream:perf',
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    await credentialVault.put('xtream:perf', XTREAM_TEST_CREDENTIALS.password);

    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 5);
    const start = performance.now();
    const result = await syncXtreamSource({ sourceId: 'perf', types: ['movie'] }, ctx);
    const ms = performance.now() - start;
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().heapUsed);

    expect(result.types.movie).toMatchObject({ status: 'ok', items: COUNT, skipped: 0 });
    expect(await catalogRepo.count('perf', 'movie')).toBe(COUNT);

    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    process.stdout.write(
      `\n[SRC-07 perf] ${COUNT} VOD items, JSON ${mb(body.length)} MB: sync ${ms.toFixed(0)} ms, ` +
        `heap baseline ${mb(baseline)} MB, peak ${mb(peak)} MB (+${mb(peak - baseline)} MB)\n`,
    );
    // Generous bounds: catch pathological regressions only.
    expect(ms).toBeLessThan(90_000);
  });
});
