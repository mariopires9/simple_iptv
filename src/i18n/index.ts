// UI strings per locale and feature module: src/i18n/<locale>/<feature>.ts (ADR-015).
// `en` is the base locale and defines the message shape; other locales must match it exactly.
//
// TEC-01: only the eager namespaces (shell, onboarding guard, state views, route errors) are in
// the initial bundle. Feature namespaces load with their feature: routes declare them in
// `lazyScreen(load, name, namespaces)`, which awaits `ensureMessages` with the screen chunk.
// Feature code keeps reading `t.<namespace>.<key>`.
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

/** Namespaces loaded with their feature (never in the initial bundle). */
export type LazyNamespace = 'favorites' | 'live' | 'movies' | 'onboarding' | 'player' | 'sources';
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

// Resolved once at load time; `setLocale` switches it (UI and persistence come with UX-06).
const registry = createMessageRegistry<EagerMessages, LazyMessages, Locale>({
  locale: detectLocale(),
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
