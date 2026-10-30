// Text of a list's guide status (EPG-02, EPG-03 AC4): last update, failure reason, and the share
// of channels that have a guide. Pure; messages and locale are parameters.
import type { Source } from '@/core/db';
import type { Locale, Messages } from '@/i18n';
import { formatRelativeTime } from './format';

/** Share of channels with a guide, 0–1, or `undefined` before the first successful import. */
export function epgCoverage(source: Pick<Source, 'epgStatus'>): number | undefined {
  const status = source.epgStatus;
  if (status?.channels === undefined || status.channelsWithEpg === undefined) return undefined;
  return status.channels === 0 ? 0 : status.channelsWithEpg / status.channels;
}

export function describeEpgStatus(
  source: Pick<Source, 'epgStatus'>,
  messages: Messages,
  locale: Locale,
  now: number,
): string {
  const text = messages.sources.edit.epg;
  const status = source.epgStatus;
  if (!status) return text.never;
  const when = formatRelativeTime(status.at, now, locale);
  if (status.status === 'error') {
    const reason = text.errors[status.error ?? 'unknown'] ?? text.errors.unknown ?? '';
    return text.failed(when, reason);
  }
  const share = epgCoverage(source) ?? 0;
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return `${text.updated(when)} ${text.coverage(
    percent.format(share),
    number.format(status.channelsWithEpg ?? 0),
    number.format(status.channels ?? 0),
  )}`;
}
