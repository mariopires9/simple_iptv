// PWA-04 AC2: when the connection returns, the scheduled syncs that were skipped resume.
import { describe, expect, it, vi } from 'vitest';
import { createConnectivityStore, type ConnectivityEnv } from '@/core/net/connectivity';
import { installResumeOnReconnect } from './resumeOnReconnect';

function setup() {
  let onLine = true;
  const listeners = new Set<() => void>();
  const env: ConnectivityEnv = {
    onLine: () => onLine,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  const store = createConnectivityStore({ env, failureThreshold: 1 });
  const go = (online: boolean) => {
    onLine = online;
    for (const listener of [...listeners]) listener();
  };
  return { store, go, listeners };
}

describe('installResumeOnReconnect', () => {
  it('resumes once per return to online, not while online', () => {
    const { store, go } = setup();
    const resume = vi.fn(() => Promise.resolve());
    const stop = installResumeOnReconnect(store, resume);

    store.reportSuccess();
    expect(resume).not.toHaveBeenCalled();

    go(false);
    expect(resume).not.toHaveBeenCalled();
    go(true);
    expect(resume).toHaveBeenCalledTimes(1);

    // Unreachable (failures) → online again also resumes.
    store.reportFailure();
    store.reportSuccess();
    expect(resume).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a failing resume is logged, not thrown; cleanup unsubscribes', async () => {
    const { store, go, listeners } = setup();
    const resume = vi.fn(() => Promise.reject(new Error('worker unavailable')));
    const stop = installResumeOnReconnect(store, resume);
    go(false);
    go(true);
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
    go(false);
    go(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
