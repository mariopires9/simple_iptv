// UI strings per locale and feature module: src/i18n/<locale>/<feature>.ts (ADR-015).
// `en` is the base locale and defines the message shape; other locales must match it exactly.
import { en, type Messages } from './en';
import { ptPT } from './pt-PT';

export type { Messages } from './en';

export type Locale = 'en' | 'pt-PT';

export const LOCALES: readonly Locale[] = ['en', 'pt-PT'];

const catalogs: Record<Locale, Messages> = { en, 'pt-PT': ptPT };

export function messages(locale: Locale): Messages {
  return catalogs[locale];
}

/**
 * Picks the UI locale. An explicit preference wins; otherwise the first browser language we
 * support (`pt*` → 'pt-PT', `en*` → 'en'); anything else falls back to 'en'.
 */
export function detectLocale(
  preferred?: Locale | 'system',
  navigatorLanguages: readonly string[] = globalThis.navigator?.languages ?? [],
): Locale {
  if (preferred && preferred !== 'system') return preferred;
  for (const tag of navigatorLanguages) {
    const lang = tag.toLowerCase().split('-')[0];
    if (lang === 'pt') return 'pt-PT';
    if (lang === 'en') return 'en';
  }
  return 'en';
}

// Static for now: resolved once at load time. Runtime switching (React context, <html lang>)
// comes with story UX-06.
export const t = messages(detectLocale());
