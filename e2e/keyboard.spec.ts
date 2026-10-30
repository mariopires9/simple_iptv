// UX-03 AC1/AC3: the main flows with the keyboard only — add the synthetic Xtream list → watch a
// channel → change channel → open a movie → search — starting from the "Skip to content" link.
// No `click` or `fill` here: every step is Tab, arrows, Enter, Escape, `/` or typed text.
import type { Locator, Page } from '@playwright/test';
import { mainNav, PANEL, waitForCatalogue } from './support/app';
import { expect, test } from './support/test';

/** WebKit skips links on Tab (Safari's default); Alt+Tab includes them. */
let TAB = 'Tab';

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((el) => el === document.activeElement);
}

/**
 * Presses Tab until `target` has the focus: forward first, then backward, so it is found from
 * any starting point without relying on focus wrapping around the end of the document.
 */
async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  await target.waitFor({ state: 'attached' });
  for (const key of [TAB, `Shift+${TAB}`]) {
    for (let i = 0; i < (key === TAB ? max : max * 2); i++) {
      if (await isFocused(target)) return;
      await page.keyboard.press(key);
    }
  }
  if (await isFocused(target)) return;
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** Presses `key` until `target` has the focus (roving focus in a grid or a result list). */
async function pressUntilFocused(page: Page, key: string, target: Locator, max = 12) {
  for (let i = 0; i < max && !(await isFocused(target)); i++) await page.keyboard.press(key);
  await expect(target).toBeFocused();
}

test('UX-03: add a list, watch and change channel, open a movie and search with the keyboard', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith('-mobile'),
    'keyboard-only use is checked on the desktop layout',
  );
  test.slow();
  TAB = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';

  await test.step('skip link: the first tab stop, visible on focus, jumps to <main>', async () => {
    await page.goto('./');
    await expect(page).toHaveURL(/#\/onboarding$/);
    await expect(
      page.getByRole('heading', { name: 'Welcome to Simple IPTV', level: 1 }),
    ).toBeVisible();
    await page.keyboard.press(TAB);
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await expect(page).toHaveURL(/#\/onboarding$/);
  });

  await test.step('add the synthetic Xtream list', async () => {
    await tabTo(page, page.getByRole('link', { name: /Xtream Codes/ }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Add Xtream list', level: 1 })).toBeVisible();
    for (const [name, value] of [
      ['Server', PANEL.server],
      ['Username', PANEL.username],
      ['Password', PANEL.password],
    ] as const) {
      await tabTo(page, page.getByRole('textbox', { name }));
      await page.keyboard.type(value);
    }
    await tabTo(page, page.getByRole('button', { name: 'Test and save' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Connected' })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Go to Home' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  });

  const list = page.getByRole('listbox', { name: 'Channels in All' });

  await test.step('watch a channel', async () => {
    await tabTo(page, mainNav(page, 'Live'));
    await page.keyboard.press('Enter');
    // The catalogue sync runs in the background after saving.
    await waitForCatalogue(page);
    await tabTo(page, list);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    const player = page.getByRole('region', { name: 'Player: Example News HD' });
    await expect(player).toBeVisible();
    // The player takes the focus, so its shortcuts work right away.
    await expect(player).toBeFocused();
  });

  await test.step('change channel (↓) and close the player (Esc)', async () => {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('region', { name: 'Player: Notícias Exemplo' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('live-player')).toHaveCount(0);
    // UX-03 fix: focus returns to the channel list instead of the document body.
    await expect(list).toBeFocused();
  });

  await test.step('open a movie and play it', async () => {
    await tabTo(page, mainNav(page, 'Movies'));
    await page.keyboard.press('Enter');
    const grid = page.getByRole('grid');
    // The grid's single tab stop (roving tabindex), then the arrows move between posters.
    await tabTo(page, grid.locator('[data-index][tabindex="0"]'));
    const movie = grid.getByRole('link', { name: 'The Synthetic Movie (2024)' });
    await page.keyboard.press('Home');
    await pressUntilFocused(page, 'ArrowRight', movie);
    await page.keyboard.press('Enter');
    const details = page.getByRole('article', { name: 'The Synthetic Movie (2024)' });
    await expect(details.getByRole('heading', { level: 1 })).toBeVisible();
    const play = details.getByRole('button', { name: 'Play', exact: true });
    await tabTo(page, play);
    await page.keyboard.press('Enter');
    const player = page.getByRole('region', { name: 'Player: The Synthetic Movie (2024)' });
    await expect(player).toBeVisible();
    await expect(player).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(player).toHaveCount(0);
    await expect(play).toBeFocused();
  });

  await test.step('search (/) and open a result', async () => {
    await page.keyboard.press('/');
    const field = page.getByRole('searchbox', { name: 'Search channels, movies and series' });
    await expect(field).toBeFocused();
    await page.keyboard.type('news');
    const result = page.getByRole('link', { name: /Example News HD/ });
    await expect(result).toBeVisible();
    // ↓ from the field moves through the results.
    await pressUntilFocused(page, 'ArrowDown', result);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Player: Example News HD' })).toBeVisible();
  });
});
