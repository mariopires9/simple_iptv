// PWA-04: the HTTP helpers feed the connectivity store — a timeout or fetch failure asks for a
// reachability probe (the store decides), mixed content never does, any answer is a success.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity';
import { fetchText, type FetchImpl } from './http';

const URL = 'https://panel.example.test/player_api.php';

const hanging: FetchImpl = (_url, init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

let failure: ReturnType<typeof vi.spyOn>;
let success: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  failure = vi.spyOn(connectivity, 'reportFailure');
  success = vi.spyOn(connectivity, 'reportSuccess');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HTTP helpers → connectivity', () => {
  it('a timeout reports a possible connection failure', async () => {
    vi.useFakeTimers();
    const pending = fetchText(URL, { fetchImpl: hanging, timeoutMs: 10 }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    expect(failure).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it('a fetch TypeError (CORS/DNS look-alike) reports a possible failure — the probe decides', async () => {
    await fetchText(URL, {
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    }).catch(() => undefined);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it('mixed content never does (deterministic, not the link)', async () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    await fetchText('http://panel.example.test/x', {
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    }).catch(() => undefined);
    vi.unstubAllGlobals();
    expect(failure).not.toHaveBeenCalled();
  });

  it('any server answer (even an HTTP error) is a success', async () => {
    await fetchText(URL, {
      fetchImpl: () => Promise.resolve(new Response('', { status: 500 })),
    }).catch(() => undefined);
    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
  });
});
