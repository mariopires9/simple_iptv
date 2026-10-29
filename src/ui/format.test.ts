import { afterEach, describe, expect, it } from 'vitest';
import { activeLocale, setLocale } from '@/i18n';
import { formatBytes, formatPercent } from './format';

describe('formatPercent', () => {
  it('formats a 0–1 fraction as a whole percentage per locale', () => {
    expect(formatPercent(0.4, 'en')).toBe('40%');
    expect(formatPercent(0.104, 'en')).toBe('10%');
    // The pt-PT spacing depends on the ICU data of the runtime: compare with Intl itself.
    expect(formatPercent(0.4, 'pt-PT')).toBe(
      new Intl.NumberFormat('pt-PT', { style: 'percent' }).format(0.4),
    );
  });

  it('defaults to the active locale and clamps out-of-range values', () => {
    expect(formatPercent(0.5)).toBe(formatPercent(0.5, activeLocale()));
    expect(formatPercent(1.7, 'en')).toBe('100%');
    expect(formatPercent(-1, 'en')).toBe('0%');
    expect(formatPercent(Number.NaN, 'en')).toBe('0%');
  });
});

describe('formatBytes (shared by Settings › Storage and the M3U import)', () => {
  afterEach(() => setLocale('en'));

  it('decimal (SI) units with one decimal, localised by Intl', () => {
    expect(formatBytes(512)).toBe('512 byte');
    expect(formatBytes(1_500)).toBe('1.5 kB');
    expect(formatBytes(12_300_000)).toBe('12.3 MB');
    expect(formatBytes(2_340_000_000)).toBe('2.3 GB');
    expect(formatBytes(999_960)).toBe('1 MB');
    expect(formatBytes(-5)).toBe('0 byte');
    expect(formatBytes(Number.NaN)).toBe('0 byte');
  });

  it('follows the active locale', async () => {
    await setLocale('pt-PT');
    const expected = new Intl.NumberFormat('pt-PT', {
      style: 'unit',
      unit: 'megabyte',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(12.3);
    expect(formatBytes(12_300_000)).toBe(expected);
    expect(formatBytes(12_300_000, 'en')).toBe('12.3 MB');
  });
});
