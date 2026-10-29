// Number/time formatting of the catalogue screens (Movies, Series), in the active UI locale
// (`activeLocale()`). Shared since SER-01. Kept here rather than importing `formatTime` from
// `@/player/ui`: a static import of the player UI would pull it into the screen chunks (PLY-02
// lazy boundary). Words ("1 h 42 min") come from the feature's strings.
import { activeLocale } from '@/i18n';

function format(value: number, options: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale(), options).format(value);
}

/** Whole number without grouping ("2024"). */
export function formatInteger(value: number): string {
  return format(value, { useGrouping: false });
}

/** `m:ss` below one hour, `h:mm:ss` from one hour (the player's own format). */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad2 = (n: number) => format(n, { minimumIntegerDigits: 2, useGrouping: false });
  return h > 0 ? `${formatInteger(h)}:${pad2(m)}:${pad2(s)}` : `${formatInteger(m)}:${pad2(s)}`;
}

export interface DurationTexts {
  /** e.g. "1 h 42 min". */
  hoursMinutes: (hours: string, minutes: string) => string;
  /** e.g. "48 min". */
  minutes: (minutes: string) => string;
}

/** Running time: "1 h 42 min", or "48 min" below one hour; `undefined` for < 1 min. */
export function formatDuration(
  seconds: number | undefined,
  texts: DurationTexts,
): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0
    ? texts.hoursMinutes(formatInteger(h), formatInteger(m))
    : texts.minutes(formatInteger(m));
}

/** Rating with one decimal ("7.1", pt-PT "7,1"). */
export function formatRating(rating: number): string {
  return format(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** 0–1 as a whole percentage (shared with the Home cards, `@/ui/format`). */
export { formatPercent } from '@/ui/format';
