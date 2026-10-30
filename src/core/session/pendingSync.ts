// Lists waiting for their first catalogue sync after an import (EXP-01). The import writes the
// lists and restarts the app (every in-memory store re-reads storage); the restarted app's
// start-up refresh (features/sources/dueSync) takes these ids and syncs them through the
// "My lists" tracker. Kept in sessionStorage (this tab only, `simple-iptv:` prefix so "Delete all
// data" removes it); ids only, never secrets. Unavailable storage: nothing is queued (the user can
// still refresh the lists by hand).

export const PENDING_SYNC_KEY = 'simple-iptv:pending-sync';
const MAX_IDS = 500;

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Queues these list ids (added to any already queued). */
export function markSourcesForSync(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    const next = [...new Set([...peek(), ...ids])].slice(0, MAX_IDS);
    storage()?.setItem(PENDING_SYNC_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: the lists simply wait for a manual refresh.
  }
}

function peek(): string[] {
  try {
    const raw = storage()?.getItem(PENDING_SYNC_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
          .slice(0, MAX_IDS)
      : [];
  } catch {
    return [];
  }
}

/** Returns the queued ids and clears the queue. */
export function takeSourcesPendingSync(): string[] {
  const ids = peek();
  try {
    storage()?.removeItem(PENDING_SYNC_KEY);
  } catch {
    // Ignored (see above).
  }
  return ids;
}
