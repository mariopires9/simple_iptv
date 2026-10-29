// Test helper (PWA-04): a controllable environment for `createConnectivityStore` — browser
// online/offline, manual timers and clock, and a scripted reachability probe.
import {
  createConnectivityStore,
  type ConnectivityEnv,
  type ConnectivityStore,
} from '../connectivity';

export interface FakeConnectivity {
  store: ConnectivityStore;
  env: ConnectivityEnv;
  /** Browser goes online/offline (fires the event). */
  go(online: boolean): void;
  /** Answer of the next probes (`true` = reachable). */
  setReachable(reachable: boolean): void;
  probeCalls(): number;
  /** Advances the clock by `ms` and runs the timers due. */
  advance(ms: number): Promise<void>;
  listenerCount(): number;
  timerCount(): number;
}

export function fakeConnectivity(options: { online?: boolean; reachable?: boolean } = {}) {
  let onLine: boolean | undefined = options.online ?? true;
  let reachable = options.reachable ?? true;
  let now = 1_000_000;
  let probes = 0;
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 1;

  const env: ConnectivityEnv = {
    onLine: () => onLine,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    setTimeout: (callback, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    now: () => now,
  };

  const store = createConnectivityStore({
    env,
    probe: () => {
      probes += 1;
      return Promise.resolve(reachable);
    },
  });

  const fake: FakeConnectivity = {
    store,
    env,
    go(online) {
      onLine = online;
      for (const listener of [...(listeners.get(online ? 'online' : 'offline') ?? [])]) {
        listener();
      }
    },
    setReachable(value) {
      reachable = value;
    },
    probeCalls: () => probes,
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
      await store.idle();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    timerCount: () => timers.size,
  };
  return fake;
}
