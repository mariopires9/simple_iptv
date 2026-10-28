// Media time formatting for the player controls (PLY-02). Rendered with tabular-nums so the
// digits do not jitter while playing.

const pad2 = new Intl.NumberFormat('en', { minimumIntegerDigits: 2, useGrouping: false });

/**
 * `m:ss` below one hour, `h:mm:ss` from one hour. Invalid, infinite or negative values
 * (e.g. `duration` of a live stream) render as `0:00`.
 */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2.format(m)}:${pad2.format(s)}` : `${m}:${pad2.format(s)}`;
}
