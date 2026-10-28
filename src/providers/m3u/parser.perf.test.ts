// @vitest-environment node
// SRC-04 AC6: a generated 50,000-entry list (scripts/fixtures/generate-m3u.mjs) streamed in 64 KB
// chunks through the parser and the catalogue builder. Reports wall time and a rough heap delta;
// asserts only generous bounds so it does not flake on slow CI. Numbers are indicative (Node, not
// a browser worker on a weak device).
import { describe, expect, it } from 'vitest';
import { log } from '@/core/log';
import { M3uCatalogBuilder } from './catalog';
import { M3uParser, feedM3uStream } from './parser';

interface GeneratorModule {
  generateM3uLines(count: number, seed?: number): Iterable<string>;
}

const COUNT = 50_000;
const CHUNK = 64 * 1024;

async function generatedBytes(count: number): Promise<Uint8Array> {
  // Plain .mjs script without type declarations: loaded dynamically and typed here.
  const path = '../../../scripts/fixtures/generate-m3u.mjs';
  const mod = (await import(/* @vite-ignore */ path)) as GeneratorModule;
  const lines: string[] = [];
  for (const line of mod.generateM3uLines(count)) lines.push(line);
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

function chunked(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + CHUNK));
      offset += CHUNK;
    },
  });
}

describe('M3U parser throughput', () => {
  it(`parses and maps ${COUNT.toLocaleString('en')} entries in chunks`, async () => {
    const bytes = await generatedBytes(COUNT);
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    let chunks = 0;
    const started = performance.now();

    const builder = new M3uCatalogBuilder();
    const parser = new M3uParser({ onEntry: (e) => builder.add(e) });
    const completed = await feedM3uStream(chunked(bytes), parser, {
      onChunk: () => {
        chunks++;
        if (chunks % 16 === 0) heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      },
    });
    const catalog = builder.build();
    const ms = performance.now() - started;
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);

    expect(completed).toBe(true);
    expect(parser.stats.entries).toBe(COUNT);
    expect(parser.stats.skipped).toBe(0);
    expect(
      catalog.live.items.length + catalog.movie.items.length + catalog.series.items.length,
    ).toBe(COUNT);
    expect(chunks).toBeGreaterThan(10);

    const report = {
      entries: COUNT,
      bytes: bytes.length,
      chunks,
      ms: Math.round(ms),
      entriesPerSecond: Math.round(COUNT / (ms / 1000)),
      heapDeltaMb: Math.round(((heapPeak - heapBefore) / 1024 / 1024) * 10) / 10,
    };
    log.info('m3u parser perf', report);
    // Visible in the test output for the story report.
    process.stdout.write(`[perf] m3u parse+map ${JSON.stringify(report)}\n`);
    // Generous bound: ~10x the time measured on a developer machine.
    expect(ms).toBeLessThan(10_000);
  });
});
