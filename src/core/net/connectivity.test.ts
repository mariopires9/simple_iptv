// PWA-04: connectivity store — navigator.onLine + events, and request failures checked with a
// same-origin reachability probe (a provider failure never puts the app "offline").
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROBE_COOLDOWN_MS,
  UNREACHABLE_PROBE_DELAYS_MS,
  createConnectivityStore,
  createOriginProbe,
  isNetworkBlocked,
} from './connectivity';
import { fakeConnectivity } from './test-utils/fakeConnectivity';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connectivity store — browser state', () => {
  it('follows navigator.onLine and the online/offline events', () => {
    const fake = fakeConnectivity();
    const listener = vi.fn();
    fake.store.subscribe(listener);
    expect(fake.store.getSnapshot()).toBe('online');

    fake.go(false);
    expect(fake.store.getSnapshot()).toBe('offline');
    expect(isNetworkBlocked(fake.store)).toBe(true);
    fake.go(true);
    expect(fake.store.getSnapshot()).toBe('online');
    expect(isNetworkBlocked(fake.store)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('treats an unknown navigator.onLine as online', () => {
    const store = createConnectivityStore({
      env: { ...fakeConnectivity().env, onLine: () => undefined },
    });
    expect(store.getSnapshot()).toBe('online');
  });

  it('listens to the browser only while subscribed; dispose cleans up', async () => {
    const fake = fakeConnectivity({ reachable: false });
    const offA = fake.store.subscribe(() => undefined);
    const offB = fake.store.subscribe(() => undefined);
    expect(fake.listenerCount()).toBe(2); // online + offline, once
    offA();
    offB();
    expect(fake.listenerCount()).toBe(0);

    fake.store.subscribe(() => undefined);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.timerCount()).toBe(1); // backoff probe
    fake.store.dispose();
    expect(fake.listenerCount()).toBe(0);
    expect(fake.timerCount()).toBe(0);
    expect(fake.store.getSnapshot()).toBe('online');
  });
});

describe('connectivity store — request failures and the probe', () => {
  it('a provider failure with a reachable origin changes nothing (no banner)', async () => {
    const fake = fakeConnectivity({ reachable: true });
    const listener = vi.fn();
    fake.store.subscribe(listener);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(1);
    expect(fake.store.getSnapshot()).toBe('online');
    expect(listener).not.toHaveBeenCalled();
  });

  it('a dead link is detected: the probe fails → unreachable', async () => {
    const fake = fakeConnectivity({ reachable: false });
    fake.store.subscribe(() => undefined);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.store.getSnapshot()).toBe('unreachable');
    // Unreachable does not block network actions: a request that works is how it clears.
    expect(isNetworkBlocked(fake.store)).toBe(false);
  });

  it('probes are debounced: one at a time, none during the cool-down after a confirmation', async () => {
    const fake = fakeConnectivity({ reachable: true });
    fake.store.reportFailure();
    fake.store.reportFailure();
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(1);

    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(1);

    await fake.advance(PROBE_COOLDOWN_MS);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(2);

    // A real success also counts as a confirmation.
    await fake.advance(PROBE_COOLDOWN_MS);
    fake.store.reportSuccess();
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(2);
  });

  it('while unreachable: probes again with backoff, never clears on a timer alone', async () => {
    const fake = fakeConnectivity({ reachable: false });
    fake.store.subscribe(() => undefined);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(1);

    // Further failures do not add probes; only the backoff schedule does.
    fake.store.reportFailure();
    await fake.advance(UNREACHABLE_PROBE_DELAYS_MS[0]! - 1);
    expect(fake.probeCalls()).toBe(1);
    await fake.advance(1);
    expect(fake.probeCalls()).toBe(2);
    await fake.advance(UNREACHABLE_PROBE_DELAYS_MS[1]!);
    expect(fake.probeCalls()).toBe(3);
    expect(fake.store.getSnapshot()).toBe('unreachable');

    // Hours later, still unreachable (the probes keep failing).
    await fake.advance(3_600_000);
    expect(fake.store.getSnapshot()).toBe('unreachable');

    fake.setReachable(true);
    await fake.advance(60_000);
    expect(fake.store.getSnapshot()).toBe('online');
    expect(fake.timerCount()).toBe(0);
  });

  it('a request that succeeds clears unreachable at once', async () => {
    const fake = fakeConnectivity({ reachable: false });
    fake.store.reportFailure();
    await fake.store.idle();
    fake.store.reportSuccess();
    expect(fake.store.getSnapshot()).toBe('online');
    expect(fake.timerCount()).toBe(0);
  });

  it('retry() probes now (banner "Try again")', async () => {
    const fake = fakeConnectivity({ reachable: false });
    fake.store.reportFailure();
    await fake.store.idle();
    fake.setReachable(true);
    fake.store.retry();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(2);
    expect(fake.store.getSnapshot()).toBe('online');
  });

  it('without a probe (worker, tests) failures never change the state', async () => {
    const store = createConnectivityStore({ env: fakeConnectivity().env });
    store.reportFailure();
    await store.idle();
    expect(store.getSnapshot()).toBe('online');
  });

  it('no probe while the browser reports offline', async () => {
    const fake = fakeConnectivity({ online: false, reachable: false });
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.probeCalls()).toBe(0);
    expect(fake.store.getSnapshot()).toBe('offline');
  });
});

describe('connectivity store — recovery', () => {
  it('fires once per real recovery: offline→online and confirmed unreachable→online', async () => {
    const fake = fakeConnectivity({ reachable: false });
    const recovered = vi.fn();
    fake.store.onRecovery(recovered);

    fake.store.reportSuccess();
    fake.go(true); // already online: not a recovery
    expect(recovered).not.toHaveBeenCalled();

    fake.go(false);
    fake.go(true);
    expect(recovered).toHaveBeenCalledTimes(1);

    await fake.advance(PROBE_COOLDOWN_MS); // past the cool-down of the success above
    fake.store.reportFailure();
    await fake.store.idle();
    expect(fake.store.getSnapshot()).toBe('unreachable');
    fake.setReachable(true);
    fake.store.retry();
    await fake.store.idle();
    expect(recovered).toHaveBeenCalledTimes(2);

    // Provider-only failures (origin reachable) never fake a recovery.
    await fake.advance(PROBE_COOLDOWN_MS);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(recovered).toHaveBeenCalledTimes(2);
  });
});

describe('createOriginProbe', () => {
  it('HEADs the app base with a unique query and no cache; any answer counts', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    const probe = createOriginProbe('https://app.example.test/simple_iptv/', fetchImpl);
    await expect(probe()).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/app\.example\.test\/simple_iptv\/\?connectivity-probe=\d+$/);
    expect(init).toMatchObject({ method: 'HEAD', cache: 'no-store', credentials: 'omit' });
  });

  it('a network failure → false; a hang times out → false', async () => {
    expect(
      await createOriginProbe('https://app.example.test/', () =>
        Promise.reject(new TypeError('Failed to fetch')),
      )(),
    ).toBe(false);

    vi.useFakeTimers();
    const hanging = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const result = createOriginProbe('https://app.example.test/', hanging, 100)();
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe(false);
    vi.useRealTimers();
  });
});
