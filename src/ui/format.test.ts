import { describe, expect, it } from 'vitest';
import { activeLocale } from '@/i18n';
import { formatPercent } from './format';

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
