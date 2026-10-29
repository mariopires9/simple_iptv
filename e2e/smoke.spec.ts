// QA-02 AC1: smoke flow in every browser and viewport — mock Xtream onboarding → live → zapping →
// movie → search → favorites → delete data — plus the language switch and the PWA-02 cache check.
import type { Page } from '@playwright/test';
import { addXtreamSource, mainNav, openSettings, PANEL } from './support/app';
import { expect, test } from './support/test';

/** Same-origin precache only: no provider host, credential or query-carrying API URL. */
async function cachedUrls(page: Page): Promise<{ ready: boolean; urls: string[] } | null> {
  return page.evaluate(async () => {
    if (!('caches' in window) || !('serviceWorker' in navigator)) return null;
    // The app registers its worker after `load` (production build); wait for it to be active.
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000)),
    ]);
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return { ready, urls };
  });
}

/** Whether the live stream of `streamId` was requested (any container). */
function requested(streams: readonly string[], streamId: number): boolean {
  return streams.some((path) => new RegExp(`^/live/.+/${streamId}\\.`).test(path));
}

test.describe('smoke', () => {
  test('Xtream onboarding → live → zapping → movie → search → favorites → remove list', async ({
    page,
    sandbox,
    browserName,
  }) => {
    test.slow();

    await test.step('onboarding with the synthetic Xtream panel', async () => {
      await addXtreamSource(page);
      expect(sandbox.panel).toContain('auth');
      expect(sandbox.panel).toEqual(
        expect.arrayContaining(['get_live_streams', 'get_vod_streams']),
      );
    });

    await test.step('live: play a channel', async () => {
      await page.getByRole('option', { name: /Example News HD/ }).click();
      const player = page.getByRole('region', { name: 'Player: Example News HD' });
      await expect(player).toBeVisible();
      await expect.poll(() => requested(sandbox.streams, 1001)).toBe(true);
      // Playwright's Firefox build has no H.264/AAC decoders (it shows the codec error instead),
      // so actual playback is only asserted where the test stream's codecs are available.
      if (browserName === 'chromium') {
        await expect(player.getByRole('status')).toHaveText('Playing');
      }
    });

    await test.step('live: zapping with next channel', async () => {
      // "Next channel" is offered both by the controls and by the playback error overlay.
      await page.getByRole('button', { name: 'Next channel' }).click();
      await expect(page.getByRole('region', { name: 'Player: Notícias Exemplo' })).toBeVisible();
      await expect.poll(() => requested(sandbox.streams, 1002)).toBe(true);
      await page.getByRole('button', { name: 'Next channel' }).click();
      await expect(page.getByRole('region', { name: 'Player: Test Sports 1' })).toBeVisible();
      await expect.poll(() => requested(sandbox.streams, 1003)).toBe(true);
    });

    await test.step('live: mark the channel as favorite (F)', async () => {
      await page.getByRole('button', { name: 'Close player' }).click();
      // The listbox keeps focus and moves an active option (aria-activedescendant).
      const list = page.getByRole('listbox', { name: 'Channels in All' });
      await list.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('f');
      // A favorite's option gets a visually hidden "Favorite" suffix.
      await expect(page.getByRole('option', { name: /Example News HD.*Favorite/ })).toBeVisible();
    });

    await test.step('movie: details, favorite and play start', async () => {
      await mainNav(page, 'Movies').click();
      await page.getByRole('link', { name: 'The Synthetic Movie (2024)' }).click();
      const details = page.getByRole('article', { name: 'The Synthetic Movie (2024)' });
      await expect(details.getByRole('heading', { level: 1 })).toBeVisible();
      await details.getByRole('button', { name: 'Add to favorites' }).click();
      await expect(details.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
      await details.getByRole('button', { name: 'Play' }).click();
      await expect(
        page.getByRole('region', { name: 'Player: The Synthetic Movie (2024)' }),
      ).toBeVisible();
      await expect
        .poll(() => sandbox.streams)
        .toContain(`/movie/${PANEL.username}/${PANEL.password}/2001.mp4`);
      await page.getByRole('button', { name: 'Close player' }).click();
    });

    await test.step('search', async () => {
      await page.getByRole('link', { name: 'Search' }).first().click();
      await page
        .getByRole('searchbox', { name: 'Search channels, movies and series' })
        .fill('news');
      await expect(page.getByRole('link', { name: /Example News HD/ })).toBeVisible();
      await page
        .getByRole('searchbox', { name: 'Search channels, movies and series' })
        .fill('drama');
      await expect(page.getByRole('link', { name: /Example Drama/ })).toBeVisible();
    });

    await test.step('favorites', async () => {
      await mainNav(page, 'Favorites').click();
      await expect(page.getByRole('tab', { name: 'Channels' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('tabpanel').getByText('Example News HD')).toBeVisible();
      await page.getByRole('tab', { name: 'Movies' }).click();
      await expect(
        page.getByRole('tabpanel').getByText('The Synthetic Movie (2024)'),
      ).toBeVisible();
    });

    await test.step('PWA-02: nothing cross-origin or with credentials in Cache Storage', async () => {
      const result = await cachedUrls(page);
      const { ready, urls } = result ?? { ready: false, urls: [] };
      if (!ready) {
        test.info().annotations.push({
          type: 'PWA-02',
          description: `${browserName}: service worker not active, Cache Storage checked as is`,
        });
      }
      // Chromium always runs the production service worker: it must be active and hold the shell.
      if (browserName === 'chromium') expect(ready).toBe(true);
      if (ready)
        expect(urls.some((url) => new URL(url).pathname.endsWith('/index.html'))).toBe(true);
      const origin = new URL(page.url()).origin;
      const offending = urls.filter(
        (url) =>
          new URL(url).origin !== origin ||
          url.includes(PANEL.password) ||
          url.includes(PANEL.username) ||
          url.includes('example.test'),
      );
      expect(offending).toEqual([]);
    });

    await test.step('delete data: remove the list in My lists', async () => {
      // SRC-10 ("Delete all data" in Settings › Privacy) is covered by its own guarded test below;
      // until then, removing the only list deletes its catalogue, favorites and history (SRC-08).
      await page.goto('./#/settings/sources');
      await page.getByRole('button', { name: 'Remove' }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove' }).click();
      await expect(dialog).toBeHidden();
      // With no list left, the app is back at onboarding, and no screen shows the old data.
      await expect(page).toHaveURL(/#\/onboarding$/);
      await page.goto('./#/favorites');
      await expect(page).toHaveURL(/#\/onboarding$/);
      await expect(page.getByText('Example News HD')).toHaveCount(0);
    });
  });

  test('language switch to Português', async ({ page }) => {
    await addXtreamSource(page);
    await openSettings(page);
    await page.getByRole('radio', { name: 'Português' }).check();
    await expect(page.getByRole('heading', { name: 'Definições', level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    // The choice persists (UX-06 AC2): after a reload everything, navigation included, is pt-PT.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Definições', level: 1 })).toBeVisible();
    await expect(mainNav(page, 'Direto', 'Navegação principal')).toBeVisible();
  });

  test('UX-06 AC2: navigation labels switch language without a reload', async ({ page }) => {
    // Known defect (reported by QA-02): the rail/bottom-bar labels are computed once at module
    // load (src/app/shell/navItems.tsx), so they stay in the previous language until a reload.
    // `test.fail()` keeps CI green and turns red once the defect is fixed: then remove it.
    test.fail();
    await addXtreamSource(page);
    await openSettings(page);
    await page.getByRole('radio', { name: 'Português' }).check();
    await expect(page.getByRole('heading', { name: 'Definições', level: 1 })).toBeVisible();
    await expect(mainNav(page, 'Direto', 'Navegação principal')).toBeVisible({ timeout: 3_000 });
  });

  test('SRC-10: delete all data returns to onboarding with nothing left', async ({ page }) => {
    await addXtreamSource(page);
    await page.goto('./#/settings/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const deleteAll = page.getByRole('button', { name: /Delete all data/i });
    // TODO(SRC-10): remove this guard once "Delete all data" is merged.
    test.skip((await deleteAll.count()) === 0, 'SRC-10 "Delete all data" is not implemented yet');

    await deleteAll.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('DELETE');
    await dialog.getByRole('button', { name: /Delete/i }).click();
    await expect(page).toHaveURL(/#\/onboarding$/);
    const leftovers = await page.evaluate(async () => {
      const dbs = 'databases' in indexedDB ? await indexedDB.databases() : [];
      const cacheNames = await caches.keys();
      return { dbs: dbs.map((db) => db.name), cacheNames };
    });
    expect(leftovers.dbs).toEqual([]);
    // Only the service worker's app-shell precache may remain (SRC-10 AC2).
    expect(leftovers.cacheNames.filter((name) => !name.startsWith('workbox-precache'))).toEqual([]);
  });

  test('SRC-06: import a local M3U file', async ({ page }) => {
    await page.goto('./#/onboarding/m3u-file');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const input = page.locator('input[type="file"]');
    // TODO(SRC-06): remove this guard once the local file import is merged.
    test.skip((await input.count()) === 0, 'SRC-06 local M3U file import is not implemented yet');

    await input.setInputFiles(new URL('../fixtures/m3u/basic.m3u', import.meta.url).pathname);
    await page.getByRole('button', { name: /Continue|Go to Home/ }).click();
    await mainNav(page, 'Live').click();
    await expect(page.getByRole('option', { name: /Example News HD/ })).toBeVisible();
  });
});
