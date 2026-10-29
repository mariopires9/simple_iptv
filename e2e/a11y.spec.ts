// QA-02 AC2: axe on every main route, light and dark, with no serious/critical violations.
// Three tests (onboarding, browsing, settings) so they run in parallel and a failure is local.
import type { Page } from '@playwright/test';
import { addXtreamSource } from './support/app';
import { formatFindings, seriousViolations, type AxeFinding } from './support/axe';
import { expect, test } from './support/test';

interface RouteCheck {
  /** Hash route (without `#`). */
  path: string;
  /** Optional interaction after the page is ready (e.g. open the player). */
  prepare?: (page: Page) => Promise<void>;
}

/** Full-screen routes reachable before any list exists. */
const ONBOARDING: readonly RouteCheck[] = [
  { path: '/onboarding' },
  { path: '/onboarding/xtream' },
  { path: '/onboarding/m3u-url' },
  { path: '/onboarding/m3u-file' },
];

/** Browsing routes, checked with the synthetic Xtream list active. */
const BROWSE: readonly RouteCheck[] = [
  { path: '/' },
  { path: '/live' },
  {
    path: '/live',
    prepare: async (page) => {
      await page.getByRole('option', { name: /Example News HD/ }).click();
      await expect(page.getByRole('region', { name: 'Player: Example News HD' })).toBeVisible();
    },
  },
  { path: '/movies' },
  { path: '/movies/2001' },
  { path: '/series' },
  { path: '/series/3001' },
  { path: '/search' },
  { path: '/search?q=example' },
  { path: '/favorites' },
];

/** Settings and "My lists" routes, checked with the synthetic Xtream list active. */
const SETTINGS: readonly RouteCheck[] = [
  { path: '/settings' },
  { path: '/settings/privacy' },
  { path: '/settings/sources' },
  { path: '/settings/sources/add/xtream' },
  { path: '/settings/sources/add/m3u-url' },
  { path: '/settings/sources/add/m3u-file' },
  { path: '/no-such-page' },
];

/** Waits until CSS transitions/animations (MUI fades, toasts) are over, so contrast is final. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Endless ones (spinners, skeleton pulses) never finish and do not change colours for long.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

const SCHEMES = ['light', 'dark'] as const;

async function check(page: Page, route: RouteCheck): Promise<AxeFinding[]> {
  const findings: AxeFinding[] = [];
  for (const colorScheme of SCHEMES) {
    // Theme "System" follows the media query: set it before loading, so nothing is mid-transition.
    await page.emulateMedia({ colorScheme });
    await page.goto(`./#${route.path}`);
    await expect(page.locator('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
    await route.prepare?.(page);
    await settle(page);
    const label = `${route.path}${route.prepare ? ' (player open)' : ''} [${colorScheme}]`;
    findings.push(...(await seriousViolations(page, label)));
  }
  return findings;
}

async function checkAll(page: Page, routes: readonly RouteCheck[], findings: AxeFinding[]) {
  for (const route of routes) {
    await test.step(`axe ${route.path}`, async () => {
      findings.push(...(await check(page, route)));
    });
  }
}

async function report(findings: readonly AxeFinding[]): Promise<void> {
  await test.info().attach('axe-serious-critical.txt', {
    body: formatFindings(findings) || 'none',
    contentType: 'text/plain',
  });
  expect(findings, formatFindings(findings)).toEqual([]);
}

test.describe('axe: no serious or critical violations', () => {
  // Every axe run is a full-page analysis in two colour schemes; Firefox and WebKit are slower.
  test.describe.configure({ timeout: 180_000 });

  test('onboarding routes', async ({ page }) => {
    const findings: AxeFinding[] = [];
    await checkAll(page, ONBOARDING, findings);
    await report(findings);
  });

  test('browsing routes', async ({ page }) => {
    const findings: AxeFinding[] = [];
    await test.step('add the synthetic Xtream list', () => addXtreamSource(page));
    await checkAll(page, BROWSE, findings);
    await report(findings);
  });

  test('settings and list management routes', async ({ page }) => {
    const findings: AxeFinding[] = [];
    await test.step('add the synthetic Xtream list', () => addXtreamSource(page));
    await checkAll(page, SETTINGS, findings);
    await test.step('axe /settings/sources/:id/edit', async () => {
      await page.goto('./#/settings/sources');
      await page.getByRole('link', { name: 'Edit' }).first().click();
      await expect(page.getByRole('heading', { name: 'Edit list', level: 1 })).toBeVisible();
      const editPath = new URL(page.url()).hash.slice(1);
      findings.push(...(await check(page, { path: editPath })));
    });
    await report(findings);
  });
});
