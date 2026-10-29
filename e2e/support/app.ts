// Page helpers shared by the E2E specs (QA-02). Labels are the English UI strings (the default
// language with `locale: 'en-US'`), so a renamed string fails here, close to the cause.
import type { Locator, Page } from '@playwright/test';
import { expect } from './test';

/** Synthetic panel of the QA-01 fixtures (`.test` never resolves; served by the sandbox). */
export const PANEL = {
  server: 'http://panel.example.test:8080',
  username: 'jdoe',
  password: 'testpass',
} as const;

/** A link of the main navigation (rail on desktop, bottom bar on phones). */
export function mainNav(page: Page, name: string, navigation = 'Main navigation'): Locator {
  return page.getByRole('navigation', { name: navigation }).getByRole('link', { name });
}

/** Settings is in the rail on tablet/desktop and in the top bar's "More options" menu on phones. */
export async function openSettings(page: Page): Promise<void> {
  const link = mainNav(page, 'Settings');
  if (await link.isVisible()) {
    await link.click();
  } else {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

/** Onboarding → Xtream form → "Test and save" → "Go to Home", waiting for the catalogue sync. */
export async function addXtreamSource(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page).toHaveURL(/#\/onboarding$/);
  await page.getByRole('link', { name: /Xtream Codes/ }).click();
  await expect(page.getByRole('heading', { name: 'Add Xtream list', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Server' }).fill(PANEL.server);
  await page.getByRole('textbox', { name: 'Username' }).fill(PANEL.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(PANEL.password);
  await page.getByRole('button', { name: 'Test and save' }).click();
  await expect(page.getByRole('region', { name: 'Connected' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to Home' }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await waitForCatalogue(page);
}

/** The sync runs in the background after saving: wait until its channels are in the database. */
export async function waitForCatalogue(page: Page): Promise<void> {
  await mainNav(page, 'Live').click();
  await expect(page.getByRole('option', { name: /Example News HD/ })).toBeVisible({
    timeout: 20_000,
  });
}

/** Name of the app's IndexedDB database (src/core/db). */
export const DB_NAME = 'simple-iptv';

/**
 * Rows left in each non-empty object store of the app's database (empty object: no data). After
 * a restart the onboarding guard reopens the database, so an empty `simple-iptv` may exist.
 */
export async function storedRows(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    if (!names.includes(name)) return {};
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
    const counts: Record<string, number> = {};
    try {
      for (const store of Array.from(db.objectStoreNames)) {
        const count = await new Promise<number>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('count failed'));
        });
        if (count > 0) counts[store] = count;
      }
    } finally {
      db.close();
    }
    return counts;
  }, DB_NAME);
}

/**
 * Settings › Privacy › "Delete all data" (SRC-10): types the localized confirmation word and waits
 * for the app to restart on onboarding. Labels are passed for the pt-PT run.
 */
export async function deleteAllData(
  page: Page,
  labels = {
    action: 'Delete all data…',
    confirmLabel: 'Type DELETE to confirm',
    word: 'DELETE',
    confirm: 'Delete everything',
    welcome: 'Welcome to Simple IPTV',
  },
): Promise<void> {
  await page.goto('./#/settings/privacy');
  await page.getByRole('button', { name: labels.action }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: labels.confirm });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox', { name: labels.confirmLabel }).fill(labels.word);
  await confirm.click();
  await expect(page).toHaveURL(/#\/onboarding$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: labels.welcome, level: 1 })).toBeVisible();
}
