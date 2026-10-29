// Playwright E2E + axe (QA-02, docs/TEST_PLAN.md). Runs against `vite preview` of the production
// build (`npm run build` first), so the CSP, the service worker and the lazy chunks are the real
// ones. Every network request outside the preview origin is answered by the synthetic Xtream panel
// and the local test streams (e2e/support/network.ts): no test ever reaches a real provider.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
/** Must match the base the app was built with (`VITE_BASE`), e.g. `/simple_iptv/`. */
const BASE = process.env.VITE_BASE ?? '/';
const CI = Boolean(process.env.CI);

/** Viewports from docs/TEST_PLAN.md §1 (mobile 390×844, desktop 1440×900). */
const DESKTOP = { viewport: { width: 1440, height: 900 } };
/**
 * axe (QA-02 AC2) runs in Chromium and Firefox at both viewports (measured locally, 2 workers: the
 * six Firefox axe tests, desktop and mobile, took 2.1 min). WebKit runs every other spec (the smoke
 * flows, AC1) but not axe until its CI timing is known. The tablet viewport (820×1180) of the test
 * plan is not a project yet: it would add a full browser pass for a layout between the two.
 */
const NOT_AXE = { testIgnore: /a11y\.spec\.ts$/ };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    locale: 'en-US',
    timezoneId: 'Europe/Lisbon',
    // The production service worker is blocked by default: with it active, requests it handles
    // could bypass `context.route` and the sandbox. Only the smoke flow that checks Cache Storage
    // (PWA-02) and the installed app after "Delete all data" (SRC-10 AC2) allows it.
    serviceWorkers: 'block',
    // QA-02 AC3: traces and videos of failing tests end up in test-results/ (a CI artifact).
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...DESKTOP } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], ...DESKTOP } },
    // Firefox has no mobile emulation (`isMobile`): a phone-sized viewport with touch.
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    { name: 'webkit-desktop', ...NOT_AXE, use: { ...devices['Desktop Safari'], ...DESKTOP } },
    { name: 'webkit-mobile', ...NOT_AXE, use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
