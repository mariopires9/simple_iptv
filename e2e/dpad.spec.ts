// UX-05: the app driven like a TV remote — arrows, OK (Enter) and Back (Escape) only, after the
// synthetic list is added. Remote-only keys that Playwright's keyboard does not have (the Tizen
// back key, ChannelUp) are dispatched as the key events a TV browser sends.
import type { Locator, Page } from '@playwright/test';
import { addXtreamSource, mainNav } from './support/app';
import { expect, test } from './support/test';

/** Presses `key` until `target` has the focus (a few steps of spatial focus). */
async function pressUntilFocused(page: Page, key: string, target: Locator, max = 6) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

/** The focus is on an element of the page, never on the body (AC3). */
async function expectFocusKept(page: Page) {
  const tag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
  expect(tag).not.toBe('BODY');
}

/** A remote key with no Playwright name, sent to the focused element as the TV browser does. */
async function remoteKey(page: Page, init: { key: string; keyCode?: number }) {
  await page.evaluate((i) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { ...i, bubbles: true, cancelable: true }));
  }, init);
}

test('UX-05: browse, watch, zap and go back with a remote (arrows, OK, Back)', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith('-mobile'),
    'remote control use is checked on the desktop layout',
  );
  test.slow();
  await addXtreamSource(page); // ends on Live, the focus on the rail's "Live" link
  const live = mainNav(page, 'Live');
  await expect(live).toBeFocused();
  const categories = page.getByRole('navigation', { name: 'Categories' });
  const list = page.getByRole('listbox', { name: 'Channels in All' });

  await test.step('AC1: rail → categories (the current one) → channel list', async () => {
    await page.keyboard.press('ArrowRight');
    await expect(categories.locator('[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(list).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-input', 'dpad');
  });

  await test.step('AC4: OK plays; ↓ and ChannelUp zap; OK reaches the controls', async () => {
    await page.keyboard.press('Enter');
    const player = page.getByRole('region', { name: 'Player: Example News HD' });
    await expect(player).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('region', { name: 'Player: Notícias Exemplo' })).toBeFocused();
    await remoteKey(page, { key: 'ChannelUp' });
    await expect(page.getByRole('region', { name: 'Player: Example News HD' })).toBeFocused();
    await page.keyboard.press('Enter');
    // A control of the player has the focus: Play/Pause, or "Try again" when the stream cannot
    // play in this engine (Firefox has no H.264 here: the error state).
    const region = page.getByTestId('player-region');
    const focusedControl = () =>
      region.evaluate((r) => {
        const el = document.activeElement;
        return el && el !== r && r.contains(el)
          ? (el.getAttribute('aria-label') ?? el.textContent ?? '')
          : undefined;
      });
    const first = await focusedControl();
    expect(first).toBeDefined();
    // Along the control bar, and never out of the player.
    await page.keyboard.press('ArrowRight');
    const second = await focusedControl();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  await test.step('AC2: Back (Tizen key) closes the player; the list has the focus again', async () => {
    await remoteKey(page, { key: 'Unidentified', keyCode: 10009 });
    await expect(page.getByTestId('live-player')).toHaveCount(0);
    await expect(list).toBeFocused();
    await expect(page).toHaveURL(/#\/live/);
  });

  await test.step('AC1: list → categories → rail → Movies → grid', async () => {
    await page.keyboard.press('ArrowLeft');
    await expect(categories.locator('[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(live).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(mainNav(page, 'Movies')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Movies', level: 1 })).toBeVisible();
    const movie = page.getByRole('grid').getByRole('link', { name: 'The Synthetic Movie (2024)' });
    await expect(movie).toBeVisible(); // the grid lays out once its width is known
    await page.keyboard.press('ArrowRight');
    await expect(categories.locator('[aria-current="page"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(movie).toBeFocused();
  });

  await test.step('AC3: details — the focus is found again; OK plays; Back, Back', async () => {
    await page.keyboard.press('Enter');
    const details = page.getByRole('article', { name: 'The Synthetic Movie (2024)' });
    await expect(details.getByRole('heading', { level: 1 })).toBeVisible();
    // The grid cell that had the focus is gone: the first D-pad key brings it back to the page.
    await page.keyboard.press('ArrowDown');
    await expectFocusKept(page);
    const play = details.getByRole('button', { name: 'Play', exact: true });
    await pressUntilFocused(page, 'ArrowDown', play);
    await page.keyboard.press('Enter');
    const player = page.getByRole('region', { name: 'Player: The Synthetic Movie (2024)' });
    await expect(player).toBeFocused();
    await page.keyboard.press('Escape'); // closes the player
    await expect(player).toHaveCount(0);
    await expect(play).toBeFocused();
    await page.keyboard.press('Escape'); // nothing left to close: back to the grid
    await expect(page).toHaveURL(/#\/movies$/);
    const movie = page.getByRole('grid').getByRole('link', { name: 'The Synthetic Movie (2024)' });
    await expect(movie).toBeVisible();
    // The grid's tab stop takes the focus back (the poster opened before).
    await page.keyboard.press('ArrowDown');
    await expect(movie).toBeFocused();
  });
});
