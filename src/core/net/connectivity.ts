// Connectivity state (PWA-04, docs/ARCHITECTURE.md §8). Framework-free store combining the
// browser's view (`navigator.onLine` + `online`/`offline` events) with what the app sees: several
// consecutive network failures reported by the HTTP helpers (./http.ts) also count as "no
// connection" — `navigator.onLine` stays `true` on a captive portal or a dead Wi-Fi link.
//
// Only failures that point at the device's connection are counted (`offline`, `timeout`): a
// `blocked` failure is indistinguishable from a provider without CORS (RESEARCH.md §6.2), so it
// must never put the whole app in the "No connection" state.
//
// Requests made in the data worker use their own copy of this module (separate global scope), so
// only main-thread requests feed this store.

/**
 * - `online`: nothing suggests a connection problem;
 * - `offline`: the browser reports no network (`navigator.onLine === false`);
 * - `unreachable`: the browser says online, but the last requests failed for lack of network.
 */
export type ConnectivityStatus = 'online' | 'offline' | 'unreachable';

/** Consecutive connection failures that switch the state to `unreachable`. */
export const DEFAULT_FAILURE_THRESHOLD = 3;

/**
 * After this long in `unreachable` without news, the failure count is cleared so the next
 * request is tried normally (the state would otherwise stick: network actions are discouraged
 * while it lasts, so no success could ever clear it).
 */
export const DEFAULT_UNREACHABLE_RESET_MS = 30_000;

export interface ConnectivityEnv {
  /** `navigator.onLine`; `undefined` when unknown (treated as online). */
  onLine(): boolean | undefined;
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ConnectivityStoreOptions {
  env?: ConnectivityEnv;
  failureThreshold?: number;
  unreachableResetMs?: number;
}

export interface ConnectivityStore {
  /** Current status (a string: stable for `useSyncExternalStore`). */
  getSnapshot(): ConnectivityStatus;
  /** Notified on every status change. The browser events are only listened to while subscribed. */
  subscribe(listener: () => void): () => void;
  /** A request failed because of the connection (`offline` / `timeout`). */
  reportFailure(): void;
  /** A request reached a server (any HTTP status): the connection works. */
  reportSuccess(): void;
  /** The user asked to try again: forget the failures (the browser's own state still applies). */
  retry(): void;
  /** Removes listeners and timers (tests). */
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
  };
}

export function createConnectivityStore(options: ConnectivityStoreOptions = {}): ConnectivityStore {
  const env = options.env ?? browserConnectivityEnv();
  const threshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
  const resetMs = options.unreachableResetMs ?? DEFAULT_UNREACHABLE_RESET_MS;
  const listeners = new Set<() => void>();
  let failures = 0;
  let resetTimer: unknown;
  let last: ConnectivityStatus | undefined;

  const compute = (): ConnectivityStatus => {
    if (env.onLine() === false) return 'offline';
    return failures >= threshold ? 'unreachable' : 'online';
  };

  const clearResetTimer = () => {
    if (resetTimer !== undefined) env.clearTimeout(resetTimer);
    resetTimer = undefined;
  };

  /** Notifies listeners when the status changed since the last notification. */
  const publish = () => {
    const next = compute();
    if (next === last) return;
    last = next;
    for (const listener of [...listeners]) listener();
  };

  const clearFailures = () => {
    failures = 0;
    clearResetTimer();
  };

  const onBrowserChange = () => {
    // Back online (or newly offline): earlier failures say nothing about the new link.
    clearFailures();
    publish();
  };

  return {
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
    reportFailure() {
      failures += 1;
      if (failures >= threshold && resetTimer === undefined) {
        resetTimer = env.setTimeout(() => {
          resetTimer = undefined;
          failures = 0;
          publish();
        }, resetMs);
      }
      publish();
    },
    reportSuccess() {
      if (failures === 0) return;
      clearFailures();
      publish();
    },
    retry() {
      clearFailures();
      publish();
    },
    dispose() {
      clearFailures();
      listeners.clear();
      env.removeEventListener('online', onBrowserChange);
      env.removeEventListener('offline', onBrowserChange);
    },
  };
}

/** The app-wide store (main thread). */
export const connectivity: ConnectivityStore = createConnectivityStore();

/**
 * Whether network actions are blocked: only when the browser itself reports no network. In
 * `unreachable` they stay allowed — the next attempt is how the app finds out the link is back.
 */
export function isNetworkBlocked(store: ConnectivityStore = connectivity): boolean {
  return store.getSnapshot() === 'offline';
}
