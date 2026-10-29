// "Delete all data" across tabs (SRC-10): the tab that deleted everything announces it on a
// BroadcastChannel scoped to this app (the origin may host other apps, e.g. a GitHub Pages user
// site); every other tab of the app locks its database and restarts on onboarding, so none keeps
// showing — or writing back — deleted data. Also the restart itself, shared by both sides.
// No Dexie here: this module is reachable from the initial bundle.

export const DATA_DELETED_MESSAGE = 'data-deleted';

/** Absolute URL of the app's scope (`<origin><base>`). */
function appScope(): string {
  return new URL(import.meta.env.BASE_URL, globalThis.location.href).href;
}

/** Channel name, unique per app scope. */
export function dataDeletionChannelName(scope: string = appScope()): string {
  return `simple-iptv:data-deletion:${scope}`;
}

type ChannelFactory = (name: string) => BroadcastChannel;

const defaultFactory: ChannelFactory | undefined =
  typeof BroadcastChannel === 'undefined' ? undefined : (name) => new BroadcastChannel(name);

/** Tells the app's other tabs that all data was deleted. Best effort (no-op without support). */
export function announceDataDeleted(
  factory: ChannelFactory | undefined = defaultFactory,
  scope?: string,
): void {
  if (!factory) return;
  try {
    const channel = factory(dataDeletionChannelName(scope));
    channel.postMessage(DATA_DELETED_MESSAGE);
    channel.close();
  } catch {
    // Best effort: the other tabs also lock on the database's `versionchange` (core/db).
  }
}

/** Calls `onDeleted` when another tab announces the deletion; returns the stop function. */
export function watchDataDeletion(
  onDeleted: () => void,
  factory: ChannelFactory | undefined = defaultFactory,
  scope?: string,
): () => void {
  if (!factory) return () => undefined;
  let channel: BroadcastChannel;
  try {
    channel = factory(dataDeletionChannelName(scope));
  } catch {
    return () => undefined;
  }
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === DATA_DELETED_MESSAGE) onDeleted();
  };
  return () => channel.close();
}

/** Indirection so tests can observe the restart (jsdom cannot reload). */
export const appRestart = {
  /**
   * Starts the app again on onboarding (HashRouter, ADR-007): the route is set without a
   * `hashchange` (the current screens must not react to it), then the page reloads, which resets
   * every in-memory store (and lifts the database lock). The service worker serves the app shell.
   */
  restartOnOnboarding(): void {
    window.history.replaceState(null, '', '#/onboarding');
    window.location.reload();
  },
};
