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
