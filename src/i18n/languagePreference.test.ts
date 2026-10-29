// UX-06: interface language — detection on first launch (AC1), the persisted preference and
// switching (AC2), `<html lang>` (AC3) and Intl formatting in the active locale (AC5).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { messages } from './catalogs';
import {
  activeLocale,
  dateTimeFormat,
  installLanguagePreference,
  LANGUAGE_CACHE_KEY,
  languagePreference,
  numberFormat,
  resetLanguagePreferenceForTests,
  restoreLanguagePreference,
  setLanguagePreference,
  setLocale,
  subscribeLanguagePreference,
  subscribeLocale,
  t,
} from './index';

function browserLanguages(...languages: string[]) {
  return vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetLanguagePreferenceForTests();
  await setLocale('en');
  document.documentElement.lang = 'en';
  await wipeAll();
});

describe('UX-06 AC1 — first launch follows the browser language', () => {
  it.each([
    [['pt-PT'], 'pt-PT'],
    [['pt-BR', 'en'], 'pt-PT'],
    [['en-US'], 'en'],
    [['de-DE'], 'en'],
  ])('%j → %s (fresh start, nothing stored)', async (languages, expected) => {
    browserLanguages(...languages);
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.activeLocale()).toBe(expected);
    expect(fresh.languagePreference()).toBe('system');
    expect(document.documentElement.lang).toBe(expected);
  });

  it('a saved choice (localStorage mirror) wins over the browser language at start-up', async () => {
    browserLanguages('pt-PT');
    localStorage.setItem(LANGUAGE_CACHE_KEY, 'en');
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.activeLocale()).toBe('en');
    expect(fresh.languagePreference()).toBe('en');
    localStorage.removeItem(LANGUAGE_CACHE_KEY);
  });

  it('an invalid cached value is ignored', async () => {
    browserLanguages('pt-PT');
    localStorage.setItem(LANGUAGE_CACHE_KEY, 'klingon');
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.activeLocale()).toBe('pt-PT');
    expect(fresh.languagePreference()).toBe('system');
    localStorage.removeItem(LANGUAGE_CACHE_KEY);
  });
});

describe('UX-06 AC2/AC3 — choosing a language', () => {
  it('switches every string at once, notifies, updates <html lang> and persists', async () => {
    const onLocale = vi.fn();
    const onPreference = vi.fn();
    const offLocale = subscribeLocale(onLocale);
    const offPreference = subscribeLanguagePreference(onPreference);

    await setLanguagePreference('pt-PT');

    expect(activeLocale()).toBe('pt-PT');
    expect(t.routes).toBe(messages('pt-PT').routes); // eager
    expect(t.settings.sections).toEqual(messages('pt-PT').settings.sections); // lazy, loaded
    expect(document.documentElement.lang).toBe('pt-PT');
    expect(languagePreference()).toBe('pt-PT');
    expect(onLocale).toHaveBeenCalledTimes(1);
    expect(onPreference).toHaveBeenCalledTimes(1);
    expect(await settingsRepo.get('locale')).toBe('pt-PT');
    expect(localStorage.getItem(LANGUAGE_CACHE_KEY)).toBe('pt-PT');

    await setLanguagePreference('en');
    expect(activeLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    offLocale();
    offPreference();
  });

  it('"System" resolves through the browser language and clears the mirror', async () => {
    browserLanguages('pt-PT');
    await setLanguagePreference('en');
    await setLanguagePreference('system');
    expect(activeLocale()).toBe('pt-PT');
    expect(await settingsRepo.get('locale')).toBe('system');
    expect(localStorage.getItem(LANGUAGE_CACHE_KEY)).toBeNull();
  });

  it('a failed save keeps the switch (and the mirror)', async () => {
    vi.spyOn(settingsRepo, 'set').mockRejectedValue(new Error('quota'));
    await setLanguagePreference('pt-PT');
    expect(activeLocale()).toBe('pt-PT');
    expect(localStorage.getItem(LANGUAGE_CACHE_KEY)).toBe('pt-PT');
  });
});

describe('UX-06 AC2 — the stored preference is the source of truth', () => {
  it('restores the stored language at start-up', async () => {
    await settingsRepo.set('locale', 'pt-PT');
    await restoreLanguagePreference();
    expect(activeLocale()).toBe('pt-PT');
    expect(languagePreference()).toBe('pt-PT');
  });

  it('no stored value means System', async () => {
    browserLanguages('en-GB');
    localStorage.setItem(LANGUAGE_CACHE_KEY, 'pt-PT'); // stale mirror
    await restoreLanguagePreference();
    expect(languagePreference()).toBe('system');
    expect(activeLocale()).toBe('en');
    expect(localStorage.getItem(LANGUAGE_CACHE_KEY)).toBeNull();
  });

  it('a choice made while the stored value loads is not overridden', async () => {
    await settingsRepo.set('locale', 'pt-PT');
    const restoring = restoreLanguagePreference();
    await setLanguagePreference('en');
    await restoring;
    expect(activeLocale()).toBe('en');
    expect(languagePreference()).toBe('en');
  });

  it('with System, a browser language change applies at once', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference();
    await vi.waitFor(() => expect(languagePreference()).toBe('system'));
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    cleanup();
  });

  it('with an explicit choice, a browser language change is ignored', async () => {
    const languages = browserLanguages('en-US');
    await setLanguagePreference('en');
    const cleanup = installLanguagePreference();
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en');
    cleanup();
  });
});

describe('UX-06 AC5 — Intl formatting follows the active locale', () => {
  it('numbers and dates switch with the language', async () => {
    const at = Date.UTC(2026, 0, 31, 12);
    const long = { dateStyle: 'long', timeZone: 'UTC' } as const;
    expect(numberFormat().format(1234.5)).toBe('1,234.5');
    expect(dateTimeFormat(long).format(at)).toBe('January 31, 2026');
    await setLanguagePreference('pt-PT');
    expect(numberFormat().format(1234.5)).toBe(new Intl.NumberFormat('pt-PT').format(1234.5));
    expect(dateTimeFormat(long).format(at)).toBe('31 de janeiro de 2026');
  });
});
