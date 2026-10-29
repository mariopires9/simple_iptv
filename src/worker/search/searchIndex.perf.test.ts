// @vitest-environment node
// SCH-01 AC2/AC4 (NFR-04) benchmark: 100k synthetic items (src/worker/search/test-utils.ts).
// Measured in Node, not in a browser worker. The numbers are printed for the story report; the
// assertions use generous bounds (BUDGET × SLACK) so the suite does not flake on a loaded CI
// runner under coverage. The real budgets (load < 1 s, query < 100 ms) are checked by the
// recorded isolated run (`npx vitest run src/worker/search/searchIndex.perf.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { catalogRepo, closeDatabase, openDatabase, sourcesRepo } from '@/core/db';
import {
  SEARCH_INDEX_VERSION,
  buildSearchIndex,
  loadSearchIndex,
  querySearchIndex,
  serializeSearchIndex,
} from './searchIndex';
import { resetSearchCacheForTests, warmUpSearch } from './searchService';
import { syntheticCatalog } from './test-utils';

const ITEMS = 100_000;
const SOURCE = 'bench';
const LOAD_BUDGET_MS = 1000;
const QUERY_BUDGET_MS = 100;
/** Headroom for slow, parallel CI runs (the budgets themselves are verified in isolation). */
const SLACK = 5;

const QUERIES = [
  'sp', // 2-letter prefix: the broadest query the UI sends
  'news',
  'sport hd',
  'pt cinema',
  'documentry', // typo (missing letter)
  'midnigth', // transposition (2 edits; fuzzy 0.2 on 8 letters allows 2)
  'coracao', // without diacritics
  'golden river',
  '1234', // channel number
  'thunder kingdom legend',
];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
const report = (line: string) => process.stdout.write(`[SCH-01 bench] ${line}\n`);

let data = '';

beforeAll(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
});
afterAll(async () => {
  await closeDatabase();
});

describe('search index benchmark (100k items)', () => {
  it('builds, serializes, parses and answers queries', () => {
    const items = syntheticCatalog(SOURCE, ITEMS);

    let start = performance.now();
    const built = buildSearchIndex(items);
    const buildMs = performance.now() - start;

    start = performance.now();
    data = serializeSearchIndex(built);
    const serializeMs = performance.now() - start;

    start = performance.now();
    const index = loadSearchIndex(data);
    const parseMs = performance.now() - start;
    expect(index.documentCount).toBe(ITEMS);

    const perQuery: Record<string, number> = {};
    for (const q of QUERIES) {
      const runs: number[] = [];
      let total = 0;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = querySearchIndex(index, SOURCE, q);
        runs.push(performance.now() - t0);
        total = r.live.total + r.movie.total + r.series.total;
      }
      expect(total, q).toBeGreaterThan(0);
      perQuery[q] = Math.round(median(runs) * 10) / 10;
    }
    const worst = Math.max(...Object.values(perQuery));

    report(
      `items=${ITEMS} build=${buildMs.toFixed(0)}ms serialize=${serializeMs.toFixed(0)}ms ` +
        `size=${(data.length / 1048576).toFixed(1)}MB parse=${parseMs.toFixed(0)}ms ` +
        `query median ms=${JSON.stringify(perQuery)}`,
    );
    expect(parseMs).toBeLessThan(LOAD_BUDGET_MS * SLACK);
    expect(worst).toBeLessThan(QUERY_BUDGET_MS * SLACK);
  }, 60_000);

  it('loads the stored index from IndexedDB (no rebuild)', async () => {
    await sourcesRepo.put({
      id: SOURCE,
      kind: 'm3u-url',
      name: 'Bench',
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'ok',
      stats: { live: 0, movies: 0, series: 0 },
    });
    await catalogRepo.putSearchIndex({
      sourceId: SOURCE,
      data,
      builtAt: Date.now(),
      version: SEARCH_INDEX_VERSION,
    });
    resetSearchCacheForTests();
    const start = performance.now();
    const warm = await warmUpSearch(SOURCE);
    const ms = performance.now() - start;
    report(`load from IndexedDB (fake-indexeddb read + parse) ${ITEMS}: ${ms.toFixed(0)}ms`);
    expect(warm).toEqual({ sourceId: SOURCE, from: 'storage', items: ITEMS });
    expect(ms).toBeLessThan(LOAD_BUDGET_MS * SLACK);
  }, 60_000);
});
