// UX-06: interface language — detection on first launch (AC1), the persisted preference and
// switching (AC2), `<html lang>` (AC3) and Intl formatting in the active locale (AC5).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import {
  claimPlayback,
  isPlaybackActive,
  resetPlaybackForTests,
  subscribePlayback,
} from '@/core/session/playback';
import { messages } from './catalogs';
import {
  activeLocale,
  applyPendingLocale,
  hasPendingLocale,
  installLanguagePreference,
  intlDateTimeFormat,
  intlNumberFormat,
  LANGUAGE_CACHE_KEY,
  languagePreference,
  resetLanguagePreferenceForTests,
  restoreLanguagePreference,
  setLanguagePreference,
  setLocale,
  subscribeLanguagePreference,
  subscribeLocale,
  t,
} from './index';

/** The app's "player open" signal (src/app/App.tsx). */
const PLAYER = [isPlaybackActive, subscribePlayback] as const;

function browserLanguages(...languages: string[]) {
  return vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(async () => {
  vi.restoreAllMocks();
  resetLanguagePreferenceForTests();
  resetPlaybackForTests();
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
    const db = await import('@/core/db'); // the instance i18n loads on demand
    vi.spyOn(db.settingsRepo, 'set').mockRejectedValue(new Error('quota'));
    expect(await setLanguagePreference('pt-PT')).toBe('switched');
    expect(await settingsRepo.get('locale')).toBeUndefined();
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

  it('no stored value and no mirror means System', async () => {
    browserLanguages('en-GB');
    await restoreLanguagePreference();
    expect(languagePreference()).toBe('system');
    expect(activeLocale()).toBe('en');
    expect(await settingsRepo.get('locale')).toBeUndefined();
  });

  it('failed save, then restart: the mirror wins and is written back (self-heal)', async () => {
    browserLanguages('en-GB');
    // The module instance i18n loads on demand (not this file's static import).
    const db = await import('@/core/db');
    const set = vi.spyOn(db.settingsRepo, 'set').mockRejectedValueOnce(new Error('quota'));
    await setLanguagePreference('pt-PT');
    expect(await settingsRepo.get('locale')).toBeUndefined();
    set.mockRestore();

    // "Restart": a fresh module reads the mirror for the first paint…
    vi.resetModules();
    const fresh = await import('./index');
    expect(fresh.activeLocale()).toBe('pt-PT');
    // …and the start-up restore keeps it instead of falling back to System, and saves it.
    await fresh.restoreLanguagePreference();
    expect(fresh.languagePreference()).toBe('pt-PT');
    expect(fresh.activeLocale()).toBe('pt-PT');
    expect(localStorage.getItem(LANGUAGE_CACHE_KEY)).toBe('pt-PT');
    expect(await settingsRepo.get('locale')).toBe('pt-PT');
    fresh.resetLanguagePreferenceForTests();
  });

  it('a choice made while the stored value loads is not overridden', async () => {
    await settingsRepo.set('locale', 'pt-PT');
    const restoring = restoreLanguagePreference();
    await setLanguagePreference('en');
    await restoring;
    expect(activeLocale()).toBe('en');
    expect(languagePreference()).toBe('en');
  });

  it('with System, a browser language change waits for a safe point (navigation)', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference(...PLAYER);
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en'); // no switch (nor re-mount) on its own
    expect(hasPendingLocale()).toBe(true);
    applyPendingLocale();
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    expect(hasPendingLocale()).toBe(false);
    cleanup();
  });

  it('an open player (the PWA-03 playback claim) defers the switch until the last release', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference(...PLAYER);
    const releaseA = claimPlayback();
    const releaseB = claimPlayback();
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    applyPendingLocale(); // a navigation during playback
    releaseA();
    releaseA(); // idempotent
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en');
    releaseB(); // playback ended
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    cleanup();
  });

  it('after cleanup, the end of playback no longer applies anything', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference(...PLAYER);
    const release = claimPlayback();
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    cleanup();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en');
    expect(hasPendingLocale()).toBe(true); // still waiting for a navigation
  });

  it('a browser change back to the active language leaves nothing pending', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference(...PLAYER);
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    languages.mockReturnValue(['en-GB']);
    window.dispatchEvent(new Event('languagechange'));
    expect(hasPendingLocale()).toBe(false);
    cleanup();
  });

  it('an explicit choice resolves with the outcome and drops a pending browser change', async () => {
    const languages = browserLanguages('en-US');
    const cleanup = installLanguagePreference(...PLAYER);
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    expect(await setLanguagePreference('en')).toBe('unchanged');
    expect(hasPendingLocale()).toBe(false);
    expect(await setLanguagePreference('pt-PT')).toBe('switched');
    cleanup();
  });

  it('with an explicit choice, a browser language change is ignored', async () => {
    const languages = browserLanguages('en-US');
    await setLanguagePreference('en');
    const cleanup = installLanguagePreference(...PLAYER);
    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    expect(hasPendingLocale()).toBe(false);
    applyPendingLocale();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en');
    cleanup();
  });
});

describe('UX-06 AC5 — Intl formatting follows the active locale', () => {
  it('numbers and dates switch with the language; instances are cached per locale', async () => {
    const at = Date.UTC(2026, 0, 31, 12);
    const numbers = intlNumberFormat();
    const longDate = intlDateTimeFormat({ dateStyle: 'long', timeZone: 'UTC' });
    expect(numbers().format(1234.5)).toBe('1,234.5');
    expect(longDate().format(at)).toBe('January 31, 2026');
    expect(numbers()).toBe(numbers());
    await setLanguagePreference('pt-PT');
    expect(numbers().format(1234.5)).toBe(new Intl.NumberFormat('pt-PT').format(1234.5));
    expect(longDate().format(at)).toBe('31 de janeiro de 2026');
    expect(numbers('en').format(1234.5)).toBe('1,234.5');
  });
});
