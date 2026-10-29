// Programme times (EPG-01 AC4): Unix timestamps shown as wall-clock times of the device's time
// zone, in the active UI locale (`activeLocale`, the one `t` holds — UX-06 AC5).
import { activeLocale, type Locale } from '@/i18n';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `HH:mm` (or the locale's equivalent) of `epochMs`; `timeZone` is for tests only. */
export function formatTime(epochMs: number, locale: Locale = activeLocale(), timeZone?: string) {
  const id = `${locale}|${timeZone ?? ''}`;
  let formatter = formatters.get(id);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    if (timeZone !== undefined) options.timeZone = timeZone;
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(id, formatter);
  }
  return formatter.format(epochMs);
}

/** Elapsed share of a programme at `now`, 0–100. */
export function progressPercent(start: number, end: number, now: number): number {
  if (end <= start) return 0;
  return Math.round(Math.max(0, Math.min(1, (now - start) / (end - start))) * 100);
}
