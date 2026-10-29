// PWA-04: connectivity store — navigator.onLine + online/offline events + consecutive failures.
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAILURE_THRESHOLD,
  createConnectivityStore,
  isNetworkBlocked,
  type ConnectivityEnv,
} from './connectivity';

function fakeEnv(initial: boolean | undefined = true) {
  let onLine = initial;
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const env: ConnectivityEnv = {
    onLine: () => onLine,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    setTimeout: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (handle) => timers.delete(handle as number),
  };
  return {
    env,
    go(online: boolean) {
      onLine = online;
      for (const listener of listeners.get(online ? 'online' : 'offline') ?? []) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
    timerCount: () => timers.size,
  };
}

describe('connectivity store', () => {
  it('follows navigator.onLine and the online/offline events', () => {
    const fake = fakeEnv(true);
    const store = createConnectivityStore({ env: fake.env });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot()).toBe('online');

    fake.go(false);
    expect(store.getSnapshot()).toBe('offline');
    expect(isNetworkBlocked(store)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    fake.go(true);
    expect(store.getSnapshot()).toBe('online');
    expect(isNetworkBlocked(store)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('treats an unknown navigator.onLine as online', () => {
    const store = createConnectivityStore({ env: fakeEnv(undefined).env });
    expect(store.getSnapshot()).toBe('online');
  });

  it(`becomes unreachable after ${DEFAULT_FAILURE_THRESHOLD} consecutive failures`, () => {
    const fake = fakeEnv(true);
    const store = createConnectivityStore({ env: fake.env });
    const listener = vi.fn();
    store.subscribe(listener);
    for (let i = 1; i < DEFAULT_FAILURE_THRESHOLD; i += 1) store.reportFailure();
    expect(store.getSnapshot()).toBe('online');
    expect(listener).not.toHaveBeenCalled();

    store.reportFailure();
    expect(store.getSnapshot()).toBe('unreachable');
    expect(listener).toHaveBeenCalledTimes(1);
    // Unreachable does not block network actions: the next attempt is the way to find out.
    expect(isNetworkBlocked(store)).toBe(false);
  });

  it('a success in between resets the count', () => {
    const store = createConnectivityStore({ env: fakeEnv().env, failureThreshold: 2 });
    store.reportFailure();
    store.reportSuccess();
    store.reportFailure();
    expect(store.getSnapshot()).toBe('online');
    store.reportFailure();
    expect(store.getSnapshot()).toBe('unreachable');
    store.reportSuccess();
    expect(store.getSnapshot()).toBe('online');
  });

  it('the browser going back online clears the failures (AC2)', () => {
    const fake = fakeEnv(true);
    const store = createConnectivityStore({ env: fake.env, failureThreshold: 1 });
    store.subscribe(() => undefined);
    store.reportFailure();
    expect(store.getSnapshot()).toBe('unreachable');
    fake.go(false);
    expect(store.getSnapshot()).toBe('offline');
    fake.go(true);
    expect(store.getSnapshot()).toBe('online');
  });

  it('retry() forgets the failures', () => {
    const store = createConnectivityStore({ env: fakeEnv().env, failureThreshold: 1 });
    store.reportFailure();
    store.retry();
    expect(store.getSnapshot()).toBe('online');
  });

  it('unreachable clears itself after a while so it cannot stick', () => {
    const fake = fakeEnv(true);
    const store = createConnectivityStore({ env: fake.env, failureThreshold: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.reportFailure();
    store.reportFailure();
    expect(fake.timerCount()).toBe(1);
    fake.runTimers();
    expect(store.getSnapshot()).toBe('online');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('listens to the browser only while subscribed, and dispose cleans up', () => {
    const fake = fakeEnv(true);
    const store = createConnectivityStore({ env: fake.env, failureThreshold: 1 });
    const offA = store.subscribe(() => undefined);
    const offB = store.subscribe(() => undefined);
    expect(fake.listenerCount()).toBe(2); // online + offline, once
    offA();
    expect(fake.listenerCount()).toBe(2);
    offB();
    expect(fake.listenerCount()).toBe(0);

    store.subscribe(() => undefined);
    store.reportFailure();
    expect(fake.timerCount()).toBe(1);
    store.dispose();
    expect(fake.listenerCount()).toBe(0);
    expect(fake.timerCount()).toBe(0);
  });
});
