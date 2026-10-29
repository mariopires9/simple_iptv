// Number/time formatting of the Movies screens, in the active UI locale (`t.player.locale`).
// Kept here rather than importing `formatTime` from `@/player/ui`: a static import of the player
// UI would pull it into this chunk (PLY-02 lazy boundary).
import { t } from '@/i18n';

function format(value: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(t.player.locale, options).format(value);
}

/** `m:ss` below one hour, `h:mm:ss` from one hour (the player's own format). */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const int = (n: number) => format(n, { useGrouping: false });
  const pad2 = (n: number) => format(n, { minimumIntegerDigits: 2, useGrouping: false });
  return h > 0 ? `${int(h)}:${pad2(m)}:${pad2(s)}` : `${int(m)}:${pad2(s)}`;
}

/** Running time: "1 h 42 min", or "48 min" below one hour; `undefined` for < 1 min. */
export function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const int = (n: number) => format(n, { useGrouping: false });
  return h > 0 ? t.movies.details.hoursMinutes(int(h), int(m)) : t.movies.details.minutes(int(m));
}

/** Rating with one decimal ("7.1", pt-PT "7,1"). */
export function formatRating(rating: number): string {
  return format(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** 0–1 as a whole percentage ("40%", pt-PT "40 %"). */
export function formatPercent(fraction: number): string {
  return format(fraction, { style: 'percent', maximumFractionDigits: 0 });
}
