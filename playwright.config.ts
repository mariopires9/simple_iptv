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
 * axe (QA-02 AC2) runs in Chromium only, at both viewports: the rules check the DOM and the
 * computed styles, which barely depend on the engine, and axe is slower elsewhere (measured
 * locally, one worker: the onboarding scans took 30.6 s in Firefox vs 15.2 s in Chromium; under
 * parallel load Firefox hit the 3-minute test timeout). Firefox and WebKit run every other spec
 * (the smoke flows, AC1). The tablet viewport (820×1180) of the test plan is not a project yet:
 * it would add a full browser pass for a layout between the two.
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
    // QA-02 AC3: traces and videos of failing tests end up in test-results/ (a CI artifact).
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...DESKTOP } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox-desktop', ...NOT_AXE, use: { ...devices['Desktop Firefox'], ...DESKTOP } },
    // Firefox has no mobile emulation (`isMobile`): a phone-sized viewport with touch.
    {
      name: 'firefox-mobile',
      ...NOT_AXE,
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
