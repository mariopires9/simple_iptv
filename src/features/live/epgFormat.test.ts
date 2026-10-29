// EPG-01 AC4: programme times from Unix timestamps, in the device's time zone and UI locale.
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import { formatTime, progressPercent } from './epgFormat';

afterEach(() => setLocale('en'));

// 2026-01-01T12:00:00Z (fixture `start_timestamp` 1767268800).
const NOON_UTC = 1767268800_000;
// 2026-07-01T12:00:00Z (summer time in Lisbon: UTC+1).
const JULY_NOON_UTC = 1782907200_000;

describe('formatTime', () => {
  it('shows the wall-clock time of the given time zone', () => {
    expect(formatTime(NOON_UTC, 'pt-PT', 'UTC')).toBe('12:00');
    expect(formatTime(NOON_UTC, 'pt-PT', 'Asia/Tokyo')).toBe('21:00');
    expect(formatTime(NOON_UTC, 'pt-PT', 'America/New_York')).toBe('07:00');
    expect(formatTime(JULY_NOON_UTC, 'pt-PT', 'Europe/Lisbon')).toBe('13:00');
  });

  it('follows the UI locale (12-hour clock in English, 24-hour in Portuguese)', () => {
    expect(formatTime(NOON_UTC + 3 * 3_600_000, 'en', 'UTC')).toMatch(/^03:00\s?PM$/);
    expect(formatTime(NOON_UTC + 3 * 3_600_000, 'pt-PT', 'UTC')).toBe('15:00');
  });

  it('UX-06 AC5: without a locale, uses the active one (switches with the language)', async () => {
    const at = NOON_UTC + 3 * 3_600_000;
    expect(formatTime(at, undefined, 'UTC')).toMatch(/^03:00\s?PM$/);
    await setLocale('pt-PT');
    expect(formatTime(at, undefined, 'UTC')).toBe('15:00');
  });

  it('defaults to the device time zone', () => {
    const expected = new Intl.DateTimeFormat('pt-PT', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(NOON_UTC);
    expect(formatTime(NOON_UTC, 'pt-PT')).toBe(expected);
  });
});

describe('progressPercent', () => {
  it('is the elapsed share, clamped to 0–100', () => {
    expect(progressPercent(0, 100, 25)).toBe(25);
    expect(progressPercent(0, 100, -5)).toBe(0);
    expect(progressPercent(0, 100, 500)).toBe(100);
    expect(progressPercent(10, 10, 10)).toBe(0);
  });
});
