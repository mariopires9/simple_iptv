// Every namespace of every locale, statically imported: for tests and tooling only. The app reads
// strings through `t` (src/i18n/index.ts), which loads feature namespaces lazily (TEC-01); an
// eager import of this module would put every string in the initial bundle
// (src/app/initialBundle.test.ts guards against it).
import { en, type Messages } from './en';
import { ptPT } from './pt-PT';
import type { Locale } from './types';

const catalogs: Record<Locale, Messages> = { en, 'pt-PT': ptPT };

/** The complete catalog of a locale (tests and tooling only). */
export function messages(locale: Locale): Messages {
  return catalogs[locale];
}
