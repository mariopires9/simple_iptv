// PLY-07 — the upstream idle timeout counts upstream silence only: a client that stops reading a
// live stream (ManagedMediaSource `endstreaming`, Safari buffering ahead) keeps its connection.
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TEST_TOKEN,
  delay,
  openRaw,
  startProxy,
  startUpstream,
  testConfig,
} from './test-support.ts';
import { buildProxyUrl } from './url.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

const IDLE_MS = 1000;
const CHUNK = Buffer.alloc(64 * 1024, 0x47); // MPEG-TS sync bytes

/** An endless live stream that writes as fast as it is read. */
async function liveUpstream() {
  const upstream = await startUpstream((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    const pump = () => {
      while (!res.destroyed && res.write(CHUNK));
    };
    res.on('drain', pump);
    pump();
  });
  cleanups.push(upstream.close);
  return upstream;
}

async function proxy() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const started = await startProxy(testConfig({ upstream: { idleTimeoutMs: IDLE_MS } }));
  cleanups.push(started.close);
  return started;
}

/** Resolves with the bytes read in `ms`, or rejects if the response ends or fails. */
function readFor(res: IncomingMessage, ms: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const onData = (chunk: Buffer) => (bytes += chunk.length);
    const onEnd = () => reject(new Error('the stream ended'));
    res.on('data', onData);
    res.once('end', onEnd);
    res.once('error', reject);
    res.resume();
    setTimeout(() => {
      res.off('data', onData);
      res.off('end', onEnd);
      res.off('error', reject);
      res.pause();
      resolve(bytes);
    }, ms);
  });
}

describe('proxy upstream idle timeout (PLY-07)', () => {
  it('a client that stops reading for longer than the idle timeout is not cut', async () => {
    const upstream = await liveUpstream();
    const p = await proxy();
    const { req, res } = await openRaw(
      buildProxyUrl(p.url, TEST_TOKEN, `http://upstream.test:${upstream.port}/live/1.ts`),
    );
    expect(res.statusCode).toBe(200);
    expect(await readFor(res, 200)).toBeGreaterThan(0);
    // Paused (backpressure all the way to the upstream socket) for 2.5× the idle timeout.
    await delay(IDLE_MS * 2.5);
    expect(res.destroyed).toBe(false);
    expect(await readFor(res, 300)).toBeGreaterThan(CHUNK.length);
    req.destroy();
  }, 10_000);

  it('upstream silence while the client reads still times out', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.write(CHUNK); // then nothing, connection left open
    });
    cleanups.push(upstream.close);
    const p = await proxy();
    const { res } = await openRaw(
      buildProxyUrl(p.url, TEST_TOKEN, `http://upstream.test:${upstream.port}/live/2.ts`),
    );
    const started = Date.now();
    await new Promise<void>((resolve) => {
      res.on('data', () => undefined);
      res.once('close', resolve);
      res.once('error', () => resolve());
    });
    expect(Date.now() - started).toBeLessThan(IDLE_MS * 3);
  }, 10_000);
});
