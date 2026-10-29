// Whether a player is open in this tab (PWA-03 AC2): an app update must never reload the page
// under it. Framework-agnostic and reference-counted: every mounted player holds one claim.

let claims = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Marks a player as open; returns the release function (idempotent). */
export function claimPlayback(): () => void {
  claims += 1;
  if (claims === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    if (claims === 0) notify();
  };
}

/** True while at least one player is open. */
export function isPlaybackActive(): boolean {
  return claims > 0;
}

/** Called when playback becomes active or inactive; returns the unsubscribe function. */
export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only. */
export function resetPlaybackForTests(): void {
  claims = 0;
  listeners.clear();
}
