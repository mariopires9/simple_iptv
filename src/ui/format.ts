// Locale-aware number formatting shared by the features (active UI locale, ADR-015).
import { activeLocale, intlNumberFormat, type Locale } from '@/i18n';

/** 0–1 as a whole percentage in the active locale ("40%", pt-PT "40 %"), clamped to 0–100 %. */
export function formatPercent(fraction: number, locale: string = activeLocale()): string {
  const value = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * Decimal (SI) byte units, as browsers show storage and download sizes: 1 kB = 1000 bytes. The
 * unit names come from `Intl` (`unit` style), so they are localised with the number.
 */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
const byteFormats = BYTE_UNITS.map((unit, index) =>
  intlNumberFormat({
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: index === 0 ? 0 : 1,
  }),
);

/** `512 byte`, `1.5 kB`, `12.3 MB`, `2 GB` in the active locale (or `locale`). */
export function formatBytes(bytes: number, locale?: Locale): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // Rounding can reach the next unit (999.96 kB → "1,000 kB"): step up instead.
  if (unit > 0 && unit < BYTE_UNITS.length - 1 && Math.round(value * 10) / 10 >= 1000) {
    value /= 1000;
    unit++;
  }
  return (byteFormats[unit] ?? byteFormats[0]!)(locale).format(value);
}
