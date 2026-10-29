// Locale-aware number formatting shared by the features (active UI locale, ADR-015).
import { activeLocale } from '@/i18n';

/** 0–1 as a whole percentage in the active locale ("40%", pt-PT "40 %"), clamped to 0–100 %. */
export function formatPercent(fraction: number, locale: string = activeLocale()): string {
  const value = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    value,
  );
}
