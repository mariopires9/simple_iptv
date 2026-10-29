// UI strings per locale and feature module: src/i18n/<locale>/<feature>.ts (ADR-015).
// `en` is the base locale and defines the message shape; other locales must match it exactly.
//
// TEC-01: only the eager namespaces (shell, onboarding guard, state views, route errors) are in
// the initial bundle. Feature namespaces load with their feature: routes declare them in
// `lazyScreen(load, name, namespaces)`, which awaits `ensureMessages` with the screen chunk.
// Feature code keeps reading `t.<namespace>.<key>`.
// `@/core/db` (Dexie) is only imported as types here and loaded on demand (`loadSettingsRepo`),
// so it stays out of the initial chunk (ADR-003). The first paint uses the localStorage mirror.
import type { LANGUAGE_PREFERENCES as STORED_LANGUAGE_PREFERENCES } from '@/core/db';
import { log } from '@/core/log';
import type { Messages } from './en';
import { enEager } from './en/eager';
import { ptPTEager } from './pt-PT/eager';
import { createMessageRegistry, type LocaleSwitchResult, type NamespaceLoaders } from './registry';
import type { Locale } from './types';

export type { Messages } from './en';
export type { LocaleSwitchResult } from './registry';
export type { Locale } from './types';

export const LOCALES: readonly Locale[] = ['en', 'pt-PT'];

/**
 * Interface language preferences in display order (UX-06): `system` follows the browser. A copy of
 * core/db's `LANGUAGE_PREFERENCES` (importing the value would pull Dexie into the initial chunk);
 * the `satisfies` fails to compile if they ever diverge.
 */
export const LANGUAGE_PREFERENCES = [
  'system',
  'en',
  'pt-PT',
] as const satisfies typeof STORED_LANGUAGE_PREFERENCES;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

/**
 * localStorage mirror of the language preference, read synchronously so the first paint is already
 * in the chosen language (IndexedDB is async). Per-viewer convenience: IndexedDB is the source of
 * truth (`restoreLanguagePreference`).
 */
export const LANGUAGE_CACHE_KEY = 'simple-iptv:language';

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return LANGUAGE_PREFERENCES.includes(value as LanguagePreference);
}

function readCachedLanguagePreference(): LanguagePreference | undefined {
  try {
    const value = globalThis.localStorage?.getItem(LANGUAGE_CACHE_KEY);
    return isLanguagePreference(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedLanguagePreference(value: LanguagePreference): void {
  try {
    if (value === 'system') globalThis.localStorage?.removeItem(LANGUAGE_CACHE_KEY);
    else globalThis.localStorage?.setItem(LANGUAGE_CACHE_KEY, value);
  } catch {
    // Storage blocked (private mode, quota): the cache is optional.
  }
}

/** Namespaces loaded with their feature (never in the initial bundle). */
export type LazyNamespace =
  | 'favorites'
  | 'live'
  | 'movies'
  | 'onboarding'
  | 'player'
  | 'search'
  | 'series'
  | 'settings'
  | 'sources';
type EagerNamespace = Exclude<keyof Messages, LazyNamespace>;
type EagerMessages = Pick<Messages, EagerNamespace>;
type LazyMessages = Pick<Messages, LazyNamespace>;

const eager: Record<Locale, EagerMessages> = { en: enEager, 'pt-PT': ptPTEager };

// One small chunk per locale and namespace: never statically imported from here.
const lazy: NamespaceLoaders<LazyMessages, Locale> = {
  favorites: {
    en: () => import('./en/favorites').then((m) => m.favorites),
    'pt-PT': () => import('./pt-PT/favorites').then((m) => m.favorites),
  },
  live: {
    en: () => import('./en/live').then((m) => m.live),
    'pt-PT': () => import('./pt-PT/live').then((m) => m.live),
  },
  movies: {
    en: () => import('./en/movies').then((m) => m.movies),
    'pt-PT': () => import('./pt-PT/movies').then((m) => m.movies),
  },
  onboarding: {
    en: () => import('./en/onboarding').then((m) => m.onboarding),
    'pt-PT': () => import('./pt-PT/onboarding').then((m) => m.onboarding),
  },
  player: {
    en: () => import('./en/player').then((m) => m.player),
    'pt-PT': () => import('./pt-PT/player').then((m) => m.player),
  },
  search: {
    en: () => import('./en/search').then((m) => m.search),
    'pt-PT': () => import('./pt-PT/search').then((m) => m.search),
  },
  series: {
    en: () => import('./en/series').then((m) => m.series),
    'pt-PT': () => import('./pt-PT/series').then((m) => m.series),
  },
  settings: {
    en: () => import('./en/settings').then((m) => m.settings),
    'pt-PT': () => import('./pt-PT/settings').then((m) => m.settings),
  },
  sources: {
    en: () => import('./en/sources').then((m) => m.sources),
    'pt-PT': () => import('./pt-PT/sources').then((m) => m.sources),
  },
};

export const LAZY_NAMESPACES = Object.keys(lazy) as LazyNamespace[];

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

let preference: LanguagePreference = readCachedLanguagePreference() ?? 'system';

// Resolved at load time from the cached preference (else the browser); `setLanguagePreference`
// and `restoreLanguagePreference` switch it (UX-06).
const registry = createMessageRegistry<EagerMessages, LazyMessages, Locale>({
  locale: detectLocale(preference),
  eager,
  lazy,
  // Development and tests: an undeclared namespace fails loudly. Production: it heals itself (loads
  // the namespace, shows already loaded English strings or empty ones meanwhile) and is logged.
  guard: import.meta.env.DEV ? 'throw' : 'fallback',
  fallbackLocale: 'en',
  onMissing: (namespace, error) =>
    log.error('i18n: a feature namespace was read before it was loaded', { namespace, error }),
});

/**
 * The messages of the active locale. A lazy namespace is only present once
 * `ensureMessages(namespace)` has resolved (development builds throw on an early read;
 * production falls back, see `GuardMode` in ./registry).
 */
export const t: Messages = registry.t;

/** Loads the active locale's strings of these feature namespaces onto `t` (idempotent). */
export function ensureMessages(...namespaces: readonly LazyNamespace[]): Promise<void> {
  return registry.ensureMessages(...namespaces);
}

/** Loads every feature namespace (test setup). */
export function loadAllMessages(): Promise<void> {
  return registry.loadAll();
}

/** Tests only: removes every feature namespace from `t`, as at startup. */
export function unloadMessagesForTests(): void {
  registry.unloadAll();
}

/** Whether a feature namespace is on `t` for the active locale. */
export function isMessagesLoaded(namespace: LazyNamespace): boolean {
  return registry.isLoaded(namespace);
}

/** The locale `t` currently holds. */
export function activeLocale(): Locale {
  return registry.getLocale();
}

/**
 * Switches `t` to another locale: reloads loaded namespaces, then notifies the subscribers.
 * Resolves `'superseded'` when a later call took over (see `LocaleSwitchResult`).
 */
export function setLocale(locale: Locale): Promise<LocaleSwitchResult> {
  return registry.setLocale(locale);
}

/** Called after each locale switch; returns the unsubscribe function. */
export function subscribeLocale(listener: () => void): () => void {
  return registry.subscribe(listener);
}

// ---------------------------------------------------------------------------------------------
// `<html lang>` follows the active locale (UX-06 AC3).
// ---------------------------------------------------------------------------------------------

function syncDocumentLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = registry.getLocale();
}
syncDocumentLanguage();
registry.subscribe(syncDocumentLanguage);

// ---------------------------------------------------------------------------------------------
// Language preference (UX-06): System / English / Português, persisted in the `settings` table.
// ---------------------------------------------------------------------------------------------

const preferenceListeners = new Set<() => void>();
/** Once the user picks a language, a late read of the stored value must not override it. */
let userChoseLanguage = false;

async function loadSettingsRepo() {
  return (await import('@/core/db')).settingsRepo;
}

function publishPreference(next: LanguagePreference): void {
  writeCachedLanguagePreference(next);
  if (next === preference) return;
  preference = next;
  for (const listener of [...preferenceListeners]) listener();
}

/** Outcome of applying a preference: the switch result, or `failed` (strings unchanged). */
export type LanguageSwitchOutcome = LocaleSwitchResult | 'failed';

/** Applies the locale a preference resolves to; a switch failure keeps the current strings. */
async function applyPreference(next: LanguagePreference): Promise<LanguageSwitchOutcome> {
  try {
    return await setLocale(detectLocale(next));
  } catch (error) {
    log.warn('i18n: the interface language could not be switched', { error });
    return 'failed';
  }
}

function persistPreference(next: LanguagePreference): Promise<void> {
  return loadSettingsRepo()
    .then((settingsRepo) => settingsRepo.set('locale', next))
    .catch((error: unknown) => {
      log.warn('i18n: the language preference could not be saved', { error });
    });
}

/** What the user chose (`system` until a choice is known). */
export function languagePreference(): LanguagePreference {
  return preference;
}

/** Called when the preference changes; returns the unsubscribe function. */
export function subscribeLanguagePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

/**
 * The user picks a language (Settings › Language): every string switches at once (the app
 * re-renders on `subscribeLocale`), and the choice is saved. A failed save is only logged: the
 * localStorage mirror keeps it, and the next start-up writes it back (`restoreLanguagePreference`).
 * Resolves with the switch outcome (`unchanged` when the preference maps to the active locale).
 */
export async function setLanguagePreference(
  next: LanguagePreference,
): Promise<LanguageSwitchOutcome> {
  userChoseLanguage = true;
  pendingSystemChange = false;
  publishPreference(next);
  const [outcome] = await Promise.all([applyPreference(next), persistPreference(next)]);
  return outcome;
}

/**
 * Start-up, before the app's first render (src/app/App.tsx): reconciles with the stored
 * preference, the source of truth, unless the user already chose meanwhile. Without a stored
 * value, a choice kept by the localStorage mirror (e.g. its save failed) wins and is written back
 * (self-heal); with neither, `system`. A database error keeps the cached choice.
 */
export async function restoreLanguagePreference(): Promise<void> {
  let stored: unknown;
  try {
    stored = await (await loadSettingsRepo()).get('locale');
  } catch (error) {
    log.warn('i18n: the language preference could not be read', { error });
    return;
  }
  if (userChoseLanguage) return;
  let next: LanguagePreference;
  if (isLanguagePreference(stored)) {
    next = stored;
  } else {
    next = readCachedLanguagePreference() ?? 'system';
    if (next !== 'system') await persistPreference(next);
  }
  if (userChoseLanguage) return;
  publishPreference(next);
  await applyPreference(next);
}

// ---------------------------------------------------------------------------------------------
// Browser language changes while on `system` are not the user's doing: switching then would
// re-mount the screen (src/app/App.tsx) and tear down playback or a half-filled form. They wait
// for a safe point: the next navigation (`applyPendingLocale`) with no player holding the locale,
// or the end of playback.
// ---------------------------------------------------------------------------------------------

let pendingSystemChange = false;
let localeHolds = 0;

/**
 * Keeps a browser-driven locale switch from happening while held (a mounted player). Returns the
 * release; the last release applies a pending switch (playback ended).
 */
export function holdLocaleSwitch(): () => void {
  localeHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    localeHolds--;
    applyPendingLocale();
  };
}

/** Whether a browser language change is waiting for a safe point. */
export function hasPendingLocale(): boolean {
  return pendingSystemChange;
}

/** A safe point (navigation, playback ended): applies a pending browser language change. */
export function applyPendingLocale(): void {
  if (!pendingSystemChange || localeHolds > 0) return;
  pendingSystemChange = false;
  if (preference === 'system') void applyPreference('system');
}

/**
 * App start-up (src/app/App.tsx): while the preference is `system`, a browser language change is
 * recorded and applied at the next safe point. Returns the cleanup.
 */
export function installLanguagePreference(): () => void {
  const onLanguageChange = () => {
    if (preference !== 'system') return;
    pendingSystemChange = detectLocale('system') !== activeLocale();
  };
  globalThis.addEventListener?.('languagechange', onLanguageChange);
  return () => globalThis.removeEventListener?.('languagechange', onLanguageChange);
}

/** Tests only: back to the start-up state (`system`, nothing chosen, cached, pending or held). */
export function resetLanguagePreferenceForTests(): void {
  userChoseLanguage = false;
  pendingSystemChange = false;
  localeHolds = 0;
  writeCachedLanguagePreference('system');
  preference = 'system';
}

// ---------------------------------------------------------------------------------------------
// Intl formatters of the active locale (UX-06 AC5). Define one at module level with its options;
// calling it returns the instance for the locale active at call time (so a language switch
// applies to dates, times and numbers too), cached per locale.
// ---------------------------------------------------------------------------------------------

function perLocale<F>(create: (locale: Locale) => F): (locale?: Locale) => F {
  const cache = new Map<Locale, F>();
  return (locale = activeLocale()) => {
    let format = cache.get(locale);
    if (format === undefined) {
      format = create(locale);
      cache.set(locale, format);
    }
    return format;
  };
}

/** `const integer = intlNumberFormat(); integer().format(n)` — in the active locale. */
export function intlNumberFormat(
  options: Intl.NumberFormatOptions = {},
): (locale?: Locale) => Intl.NumberFormat {
  return perLocale((locale) => new Intl.NumberFormat(locale, options));
}

/** `const longDate = intlDateTimeFormat({ dateStyle: 'long' }); longDate().format(ms)`. */
export function intlDateTimeFormat(
  options: Intl.DateTimeFormatOptions,
): (locale?: Locale) => Intl.DateTimeFormat {
  return perLocale((locale) => new Intl.DateTimeFormat(locale, options));
}
