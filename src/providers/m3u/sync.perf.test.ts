// @vitest-environment node
// SRC-04 AC6 / SRC-05: end-to-end import of a generated 50,000-entry list (download stream →
// parser → catalogue → fake-indexeddb). Indicative numbers (Node + fake-indexeddb, which is much
// slower than a browser's IndexedDB); only generous bounds are asserted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { credentialVault } from '@/core/crypto';
import { closeDatabase, openDatabase, sourcesRepo } from '@/core/db';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { syncM3uSource, type M3uSyncProgress } from './sync';

interface GeneratorModule {
  generateM3uLines(count: number, seed?: number): Iterable<string>;
}

const COUNT = 50_000;
const SOURCE_ID = 'perf-1';

beforeAll(async () => {
  await openDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
});
afterAll(() => closeDatabase());

describe('M3U import throughput', () => {
  it(`imports ${COUNT.toLocaleString('en')} entries end to end`, async () => {
    const path = '../../../scripts/fixtures/generate-m3u.mjs';
    const mod = (await import(/* @vite-ignore */ path)) as GeneratorModule;
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let pending: string[] = [];
    for (const line of mod.generateM3uLines(COUNT)) {
      pending.push(line);
      if (pending.length === 500) {
        chunks.push(encoder.encode(`${pending.join('\n')}\n`));
        pending = [];
      }
    }
    if (pending.length > 0) chunks.push(encoder.encode(`${pending.join('\n')}\n`));

    await sourcesRepo.put({
      id: SOURCE_ID,
      kind: 'm3u-url',
      name: 'Perf',
      secretRef: `source:${SOURCE_ID}:url`,
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    await credentialVault.put(`source:${SOURCE_ID}:url`, 'https://lists.example.test/big.m3u');
    const fetchImpl = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              const next = chunks.shift();
              if (next) controller.enqueue(next);
              else controller.close();
            },
          }),
        ),
      );

    let writeStartedAt: number | undefined;
    let progressMessages = 0;
    const ctx: TaskContext = {
      progress(p) {
        progressMessages++;
        if ((p as M3uSyncProgress).phase === 'write') writeStartedAt ??= performance.now();
      },
      cancelled: false,
      throwIfCancelled() {
        if (this.cancelled) throw new WorkerTaskError('cancelled');
      },
    };
    const started = performance.now();
    const result = await syncM3uSource({ sourceId: SOURCE_ID }, ctx, { fetchImpl });
    const ended = performance.now();
    const ms = Math.round(ended - started);
    const phaseMs = {
      downloadAndParse: Math.round((writeStartedAt ?? ended) - started),
      write: Math.round(ended - (writeStartedAt ?? ended)),
    };

    expect(result.status).toBe('ok');
    expect(result.entries).toBe(COUNT);
    expect(result.stats.live + result.stats.movies + result.stats.series).toBe(COUNT);
    expect(progressMessages).toBeGreaterThan(5);
    process.stdout.write(
      `[perf] m3u import ${JSON.stringify({ entries: COUNT, bytes: result.bytes, ms, phaseMs, stats: result.stats })}\n`,
    );
    expect(ms).toBeLessThan(120_000);
  }, 180_000);
});
