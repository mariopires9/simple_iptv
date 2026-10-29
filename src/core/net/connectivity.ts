// Connectivity state (PWA-04, docs/ARCHITECTURE.md §8). Framework-free store combining the
// browser's view (`navigator.onLine` + `online`/`offline` events) with a reachability probe:
// `navigator.onLine` stays `true` on a captive portal or a dead Wi-Fi link.
//
// A failed request to a provider (timeout, or a fetch `TypeError` — CORS, DNS and refused
// connections all look the same, RESEARCH.md §6.2) says nothing by itself about the device's
// connection. So it only *triggers a probe* of the app's own origin (see `createOriginProbe`):
// - the probe fails → the device has no working link → `unreachable`;
// - the probe succeeds → the provider is the problem → no state change (no banner).
// While `unreachable`, the probe is repeated with backoff; the state only clears when a probe or
// a real request succeeds, or the browser fires `online`/`offline` — never on a blind timer.
//
// Requests made in the data worker use their own copy of this module (separate global scope, no
// probe installed), so only main-thread requests feed this store.

/**
 * - `online`: nothing suggests a connection problem;
 * - `offline`: the browser reports no network (`navigator.onLine === false`);
 * - `unreachable`: the browser says online, but the app's own origin cannot be reached.
 */
export type ConnectivityStatus = 'online' | 'offline' | 'unreachable';

/** Resolves `true` when the network answered (any HTTP status), `false` otherwise. */
export type ReachabilityProbe = () => Promise<boolean>;

/** A probe that confirmed the link is not repeated for this long after a request failure. */
export const PROBE_COOLDOWN_MS = 15_000;

/** Delays between probes while `unreachable` (the last one repeats). */
export const UNREACHABLE_PROBE_DELAYS_MS: readonly number[] = [
  5_000, 10_000, 20_000, 40_000, 60_000,
];

export interface ConnectivityEnv {
  /** `navigator.onLine`; `undefined` when unknown (treated as online). */
  onLine(): boolean | undefined;
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface ConnectivityStoreOptions {
  env?: ConnectivityEnv;
  /** Without a probe, request failures never change the state (worker, tests). */
  probe?: ReachabilityProbe;
}

export interface ConnectivityStore {
  /** Current status (a string: stable for `useSyncExternalStore`). */
  getSnapshot(): ConnectivityStatus;
  /** Notified on every status change. The browser events are only listened to while subscribed. */
  subscribe(listener: () => void): () => void;
  /**
   * Notified once per real recovery: `offline` → `online` (browser event) or `unreachable` →
   * `online` (confirmed by a probe or a request that succeeded).
   */
  onRecovery(listener: () => void): () => void;
  /** A request failed in a way that might be the device's link (timeout, fetch `TypeError`). */
  reportFailure(): void;
  /** A request reached a server (any HTTP status): the connection works. */
  reportSuccess(): void;
  /** The user asked to try again: probe now (only meaningful while `unreachable`). */
  retry(): void;
  /** Installs (or replaces) the reachability probe. */
  setProbe(probe: ReachabilityProbe | undefined): void;
  /** Resolves when no probe is running (tests). */
  idle(): Promise<void>;
  /** Removes listeners and timers, forgets the state (tests). */
  dispose(): void;
}

function browserConnectivityEnv(): ConnectivityEnv {
  const g = globalThis as {
    navigator?: { onLine?: unknown };
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  return {
    onLine: () => (typeof g.navigator?.onLine === 'boolean' ? g.navigator.onLine : undefined),
    addEventListener: (type, listener) => g.addEventListener?.(type, listener),
    removeEventListener: (type, listener) => g.removeEventListener?.(type, listener),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
}

export function createConnectivityStore(options: ConnectivityStoreOptions = {}): ConnectivityStore {
  const env = options.env ?? browserConnectivityEnv();
  let probe = options.probe;
  const listeners = new Set<() => void>();
  const recoveryListeners = new Set<() => void>();
  let unreachable = false;
  let probing: Promise<void> | undefined;
  let lastConfirmedAt = Number.NEGATIVE_INFINITY;
  let backoffTimer: unknown;
  let backoffStep = 0;
  let last: ConnectivityStatus = 'online';
  let generation = 0;

  const compute = (): ConnectivityStatus => {
    if (env.onLine() === false) return 'offline';
    return unreachable ? 'unreachable' : 'online';
  };

  const clearBackoff = () => {
    if (backoffTimer !== undefined) env.clearTimeout(backoffTimer);
    backoffTimer = undefined;
  };

  /** Notifies on a status change; a change back to `online` is a recovery. */
  const publish = () => {
    const next = compute();
    if (next === last) return;
    const recovered = next === 'online';
    last = next;
    for (const listener of [...listeners]) listener();
    if (recovered) for (const listener of [...recoveryListeners]) listener();
  };

  const markReachable = () => {
    lastConfirmedAt = env.now();
    backoffStep = 0;
    clearBackoff();
    unreachable = false;
    publish();
  };

  const scheduleProbe = () => {
    clearBackoff();
    const delays = UNREACHABLE_PROBE_DELAYS_MS;
    const delay = delays[Math.min(backoffStep, delays.length - 1)] ?? 60_000;
    backoffStep += 1;
    backoffTimer = env.setTimeout(() => {
      backoffTimer = undefined;
      runProbe();
    }, delay);
  };

  function runProbe(): void {
    if (probing || probe === undefined || env.onLine() === false) return;
    const run = probe;
    const started = generation;
    probing = (async () => {
      let reachable: boolean;
      try {
        reachable = await run();
      } catch {
        reachable = false;
      }
      if (started !== generation) return; // disposed or the browser changed state meanwhile
      if (reachable) {
        markReachable();
      } else {
        unreachable = true;
        publish();
        scheduleProbe();
      }
    })().finally(() => {
      probing = undefined;
    });
  }

  const onBrowserChange = () => {
    // The browser's own verdict wins; earlier probes say nothing about the new link.
    generation += 1;
    unreachable = false;
    backoffStep = 0;
    clearBackoff();
    publish();
  };

  const store: ConnectivityStore = {
    getSnapshot: compute,
    subscribe(listener) {
      if (listeners.size === 0) {
        env.addEventListener('online', onBrowserChange);
        env.addEventListener('offline', onBrowserChange);
        last = compute();
      }
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        env.removeEventListener('online', onBrowserChange);
        env.removeEventListener('offline', onBrowserChange);
      };
    },
    onRecovery(listener) {
      // Also keeps the browser events attached while someone waits for a recovery.
      const unsubscribe = store.subscribe(() => undefined);
      recoveryListeners.add(listener);
      return () => {
        recoveryListeners.delete(listener);
        unsubscribe();
      };
    },
    reportFailure() {
      // Debounced: one probe at a time, none right after a confirmation, none while the backoff
      // probes are already running.
      if (unreachable || probing) return;
      if (env.now() - lastConfirmedAt < PROBE_COOLDOWN_MS) return;
      runProbe();
    },
    reportSuccess() {
      if (unreachable) {
        generation += 1; // a probe in flight is now moot
        markReachable();
      } else {
        lastConfirmedAt = env.now();
      }
    },
    retry() {
      if (!unreachable) return;
      clearBackoff();
      runProbe();
    },
    setProbe(next) {
      probe = next;
    },
    idle: async () => {
      while (probing) await probing;
    },
    dispose() {
      generation += 1;
      clearBackoff();
      unreachable = false;
      backoffStep = 0;
      lastConfirmedAt = Number.NEGATIVE_INFINITY;
      last = 'online';
      listeners.clear();
      recoveryListeners.clear();
      env.removeEventListener('online', onBrowserChange);
      env.removeEventListener('offline', onBrowserChange);
    },
  };
  return store;
}

/** Timeout of one reachability probe. */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Probe of the app's own origin: a `HEAD` request for `baseUrl` with a unique query
 * (`?connectivity-probe=<ts>`), `cache: 'no-store'`. The service worker never answers it: its
 * precache only matches GET requests for the exact precached URLs (only `utm_*`/`fbclid` query
 * parameters are ignored, build/pwa.ts) and it has no runtime routes — so it really reaches the
 * network. Any HTTP answer counts as reachable. No data leaves the device: it is the app's host.
 */
export function createOriginProbe(
  baseUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = PROBE_TIMEOUT_MS,
): ReachabilityProbe {
  return async () => {
    const url = new URL(baseUrl);
    url.searchParams.set('connectivity-probe', String(Date.now()));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetchImpl(url.href, {
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The app-wide store (main thread). The probe is installed at start-up (src/main.tsx). */
export const connectivity: ConnectivityStore = createConnectivityStore();

/**
 * Whether network actions are blocked: only when the browser itself reports no network. In
 * `unreachable` they stay allowed — a request that succeeds is one way the app finds out the
 * link is back.
 */
export function isNetworkBlocked(store: ConnectivityStore = connectivity): boolean {
  return store.getSnapshot() === 'offline';
}
