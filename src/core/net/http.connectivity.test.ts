// PWA-04: the HTTP helpers feed the connectivity store — connection failures count, CORS-like
// blocks do not (a provider without CORS must not look like "no connection"), any answer resets.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FAILURE_THRESHOLD, connectivity } from './connectivity';
import { fetchText, type FetchImpl } from './http';

const URL = 'https://panel.example.test/player_api.php';

const hanging: FetchImpl = (_url, init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

afterEach(() => {
  connectivity.retry();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function timeOut(): Promise<void> {
  vi.useFakeTimers();
  const pending = fetchText(URL, { fetchImpl: hanging, timeoutMs: 10 }).catch(() => undefined);
  await vi.advanceTimersByTimeAsync(10);
  await pending;
  vi.useRealTimers();
}

describe('HTTP helpers → connectivity', () => {
  it(`${DEFAULT_FAILURE_THRESHOLD} timeouts in a row make the network unreachable`, async () => {
    for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i += 1) await timeOut();
    expect(connectivity.getSnapshot()).toBe('unreachable');
  });

  it('any server answer (even an HTTP error) clears the failures', async () => {
    for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD; i += 1) await timeOut();
    await fetchText(URL, {
      fetchImpl: () => Promise.resolve(new Response('', { status: 500 })),
    }).catch(() => undefined);
    expect(connectivity.getSnapshot()).toBe('online');
  });

  it('blocked (CORS-like) failures never count', async () => {
    for (let i = 0; i < DEFAULT_FAILURE_THRESHOLD + 2; i += 1) {
      await fetchText(URL, {
        fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
      }).catch(() => undefined);
    }
    expect(connectivity.getSnapshot()).toBe('online');
  });
});
