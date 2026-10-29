// PWA-04 AC2: when the connection really returns, the scheduled syncs that were skipped resume —
// once per recovery, never in a loop.
import { describe, expect, it, vi } from 'vitest';
import { PROBE_COOLDOWN_MS } from '@/core/net/connectivity';
import { fakeConnectivity } from '@/core/net/test-utils/fakeConnectivity';
import { installResumeOnReconnect } from './resumeOnReconnect';

describe('installResumeOnReconnect', () => {
  it('runs on offline → online, not while online', () => {
    const fake = fakeConnectivity();
    const resume = vi.fn(() => Promise.resolve());
    const stop = installResumeOnReconnect(fake.store, resume);

    fake.store.reportSuccess();
    fake.go(true);
    expect(resume).not.toHaveBeenCalled();

    fake.go(false);
    fake.go(true);
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs on unreachable → online only once a probe confirms it', async () => {
    const fake = fakeConnectivity({ reachable: false });
    const resume = vi.fn(() => Promise.resolve());
    installResumeOnReconnect(fake.store, resume);
    fake.store.reportFailure();
    await fake.store.idle();
    await fake.advance(60_000); // backoff probes keep failing
    expect(resume).not.toHaveBeenCalled();

    fake.setReachable(true);
    await fake.advance(60_000);
    expect(resume).toHaveBeenCalledTimes(1);

    // A provider-only failure afterwards (origin reachable) is not a recovery.
    await fake.advance(PROBE_COOLDOWN_MS);
    fake.store.reportFailure();
    await fake.store.idle();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('never overlaps: a recovery while the previous resume runs is ignored', async () => {
    const fake = fakeConnectivity();
    let finish!: () => void;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    installResumeOnReconnect(fake.store, resume);
    fake.go(false);
    fake.go(true);
    fake.go(false);
    fake.go(true);
    expect(resume).toHaveBeenCalledTimes(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.go(false);
    fake.go(true);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('a failing resume is logged, not thrown; cleanup unsubscribes', async () => {
    const fake = fakeConnectivity();
    const resume = vi.fn(() => Promise.reject(new Error('worker unavailable')));
    const stop = installResumeOnReconnect(fake.store, resume);
    fake.go(false);
    fake.go(true);
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
    expect(fake.listenerCount()).toBe(0);
    fake.go(false);
    fake.go(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
