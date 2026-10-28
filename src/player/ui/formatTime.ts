// Number formatting for the player controls (PLY-02), always in the active UI locale
// (`t.player.locale`, the same catalog as every other string). Times are rendered with
// tabular-nums so the digits do not jitter while playing.
import { t } from '@/i18n';

const cache = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/**
 * `m:ss` below one hour, `h:mm:ss` from one hour. Invalid, infinite or negative values
 * (e.g. `duration` of a live stream) render as `0:00`.
 */
export function formatTime(seconds: number, locale: string = t.player.locale): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const int = formatter(locale, { useGrouping: false });
  const pad2 = formatter(locale, { minimumIntegerDigits: 2, useGrouping: false });
  return h > 0
    ? `${int.format(h)}:${pad2.format(m)}:${pad2.format(s)}`
    : `${int.format(m)}:${pad2.format(s)}`;
}

/** 0–1 as a whole percentage (`50%`, pt-PT `50 %`). */
export function formatPercent(fraction: number, locale: string = t.player.locale): string {
  return formatter(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction);
}
