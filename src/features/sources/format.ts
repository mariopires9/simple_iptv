// Text of a list card (SRC-08 AC1): relative "last sync" time, counts and the sync status with a
// short reason mapped from the stable error codes. Pure; the locale and messages are parameters
// so both UI languages are testable.
import type { ContentType, Source } from '@/core/db';
import type { Locale, Messages } from '@/i18n';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * DAY],
  ['month', 30 * DAY],
  ['week', 7 * DAY],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
];

/** "2 hours ago", "yesterday", "now" (`Intl.RelativeTimeFormat`, numeric: auto). */
export function formatRelativeTime(at: number, now: number, locale: Locale): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = at - now;
  const abs = Math.abs(diff);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return format.format(Math.round(diff / size), unit);
  }
  return format.format(0, 'second');
}

/** "Xtream · 1,234 channels · 8,900 movies · 410 series" (movies/series only when relevant). */
export function describeContents(
  source: Pick<Source, 'kind' | 'stats'>,
  messages: Messages,
  locale: Locale,
): string {
  const text = messages.sources.myLists;
  const number = new Intl.NumberFormat(locale);
  const { live, movies, series } = source.stats;
  const parts = [text.kinds[source.kind], text.counts.channels(live, number.format(live))];
  // Xtream lists always have the three catalogues; M3U lists only when they hold VOD entries.
  if (source.kind === 'xtream' || movies > 0) {
    parts.push(text.counts.movies(movies, number.format(movies)));
  }
  if (source.kind === 'xtream' || series > 0) {
    parts.push(text.counts.series(series, number.format(series)));
  }
  return parts.join(' · ');
}

/** "Updated 2 hours ago" / "Never updated". */
export function describeLastSync(
  source: Pick<Source, 'lastSyncAt'>,
  now: number,
  messages: Messages,
  locale: Locale,
): string {
  const text = messages.sources.myLists;
  return source.lastSyncAt === undefined
    ? text.neverUpdated
    : text.updated(formatRelativeTime(source.lastSyncAt, now, locale));
}

type ReasonCode = keyof Messages['sources']['myLists']['reasons'];

/** Short localized reason for a sync error code; unknown codes → "unknown error". */
export function reasonText(code: string | undefined, messages: Messages): string {
  const reasons = messages.sources.myLists.reasons;
  return code !== undefined && Object.hasOwn(reasons, code)
    ? reasons[code as ReasonCode]
    : reasons.unknown;
}

export type SourceStatusTone = 'neutral' | 'ok' | 'warning' | 'error';

export interface SourceStatusText {
  tone: SourceStatusTone;
  text: string;
}

const TYPE_ORDER: readonly ContentType[] = ['live', 'movie', 'series'];

/** Status line of a card: ok / partial (which types failed and why) / error (why). */
export function describeStatus(
  source: Pick<Source, 'lastSyncStatus' | 'lastSyncError' | 'lastSyncByType'>,
  messages: Messages,
  locale: Locale,
): SourceStatusText {
  const status = messages.sources.myLists.status;
  const failed = TYPE_ORDER.filter((type) => source.lastSyncByType?.[type]?.status === 'error');
  const firstCode = failed.map((type) => source.lastSyncByType?.[type]?.error)[0];
  switch (source.lastSyncStatus) {
    case 'ok':
      return { tone: 'ok', text: status.ok };
    case 'syncing':
      return { tone: 'neutral', text: status.syncing };
    case 'never':
      return { tone: 'neutral', text: status.never };
    case 'partial': {
      const names = failed.map((type) => messages.sources.myLists.contentTypes[type]);
      const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
      return {
        tone: 'warning',
        text: status.partial(list, reasonText(firstCode ?? source.lastSyncError, messages)),
      };
    }
    case 'error':
      return {
        tone: 'error',
        text: status.error(reasonText(source.lastSyncError ?? firstCode, messages)),
      };
  }
}
