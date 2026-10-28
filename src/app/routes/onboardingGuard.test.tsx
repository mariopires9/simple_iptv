// UX-01: onboarding guard (AC1), the onboarding screen (AC2) and the first-run flow up to Home
// (AC3) on the real route tree, with fake-indexeddb and the synthetic MSW panel.
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { invalidateSourcesPresence } from '@/features/sources';
import { t } from '@/i18n';
import { XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { AppRouter, appRoutes } from '../router';
import { isOnboardingExempt } from './onboardingGuard';

const sync = vi.hoisted(() => ({ start: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/sources/sync', () => ({ startInitialSync: sync.start }));

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let media: ReturnType<typeof installMatchMedia> | undefined;

afterEach(async () => {
  server.resetHandlers();
  media?.restore();
  media = undefined;
  invalidateSourcesPresence();
  clearSecrets();
  sync.start.mockClear();
  await wipeAll();
});

function renderRoute(path: string) {
  media = installMatchMedia({ width: 1400 });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeModeProvider>
      <ToastProvider>
        <AppRouter router={router} />
      </ToastProvider>
    </ThemeModeProvider>,
  );
  return router;
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const ONBOARDING = t.onboarding.title;
/** Option cards are named by title + description (+ badge). */
const startsWith = (title: string) => (name: string) => name.startsWith(title);

describe('UX-01 AC1 — redirect without sources', () => {
  it.each(['/', '/live', '/movies/category/1', '/series/7', '/favorites', '/search', '/nope'])(
    '%s → /onboarding (full screen)',
    async (path) => {
      const router = renderRoute(path);
      await heading(ONBOARDING);
      expect(router.state.location.pathname).toBe('/onboarding');
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    },
  );

  it.each([
    ['/settings', t.routes.screens.settings.title],
    ['/settings/privacy', t.onboarding.privacy.title],
    ['/settings/sources', t.routes.screens.sources.title],
    ['/Settings/Sources', t.routes.screens.sources.title],
    ['/settings/sources/add/xtream', t.sources.addXtream.title],
  ])('%s stays reachable', async (path, title) => {
    const router = renderRoute(path);
    await heading(title);
    expect(router.state.location.pathname).toBe(path);
  });

  it('with a stored source there is no redirect', async () => {
    await sourcesRepo.put({
      id: 's1',
      kind: 'xtream',
      name: 'Test',
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    const router = renderRoute('/live');
    await heading(t.routes.screens.live.title);
    expect(router.state.location.pathname).toBe('/live');
  });

  it('isOnboardingExempt: Settings and its pages only', () => {
    expect(isOnboardingExempt('/settings')).toBe(true);
    expect(isOnboardingExempt('/settings/privacy')).toBe(true);
    expect(isOnboardingExempt('/SETTINGS/sources')).toBe(true);
    expect(isOnboardingExempt('/settingsx')).toBe(false);
    expect(isOnboardingExempt('/')).toBe(false);
  });
});

describe('UX-01 AC2 — onboarding screen', () => {
  it('shows the three options (Xtream recommended), the note and "Learn more"', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/onboarding');
    await heading(ONBOARDING);
    const o = t.onboarding.options;
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links).toEqual([
      '/onboarding/xtream',
      '/onboarding/m3u-url',
      '/onboarding/m3u-file',
      '/settings/privacy',
    ]);
    const xtream = screen.getByRole('link', { name: startsWith(o.xtream.title) });
    expect(xtream).toHaveTextContent(o.xtream.recommended);
    expect(screen.getByRole('link', { name: startsWith(o.m3uUrl.title) })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: startsWith(o.m3uFile.title) })).toBeInTheDocument();
    expect(screen.getByText(t.onboarding.note, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(t.onboarding.legal)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: t.onboarding.learnMore }));
    await heading(t.onboarding.privacy.title);
    expect(router.state.location.pathname).toBe('/settings/privacy');
  });

  it.each([
    ['m3uUrl', t.sources.comingSoon.m3uUrl],
    ['m3uFile', t.sources.comingSoon.m3uFile],
  ] as const)('%s option → "coming soon" with a way back', async (id, text) => {
    const user = userEvent.setup();
    const router = renderRoute('/onboarding');
    await heading(ONBOARDING);
    await user.click(
      screen.getByRole('link', { name: startsWith(t.onboarding.options[id].title) }),
    );
    await heading(text.title);
    expect(screen.getByText(text.message)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: t.sources.comingSoon.back }));
    await heading(ONBOARDING);
    expect(router.state.location.pathname).toBe('/onboarding');
  });
});

describe('UX-01 AC3 — first source saved → onboardingDone and Home', () => {
  it('Xtream → test and save → Home, no more redirects', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/');
    await heading(ONBOARDING);

    await user.click(
      screen.getByRole('link', { name: startsWith(t.onboarding.options.xtream.title) }),
    );
    await heading(t.sources.addXtream.title);
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();

    const input = (label: string) =>
      screen.getByLabelText(label, { exact: false, selector: 'input' });
    await user.type(input(t.sources.fields.server), 'panel.example.test:8080');
    await user.type(input(t.sources.fields.username), XTREAM_TEST_CREDENTIALS.username);
    await user.type(input(t.sources.fields.password), XTREAM_TEST_CREDENTIALS.password);
    await user.click(screen.getByRole('button', { name: t.sources.submit }));

    await screen.findByRole('heading', { name: t.sources.result.title });
    await user.click(screen.getByRole('button', { name: t.sources.result.continue }));

    await heading(t.routes.screens.home.title);
    expect(router.state.location.pathname).toBe('/');
    expect(await settingsRepo.get('onboardingDone')).toBe(true);
    const [source] = await sourcesRepo.list();
    expect(sync.start).toHaveBeenCalledExactlyOnceWith(source?.id);

    // Other main routes no longer redirect.
    await user.click(screen.getByRole('link', { name: t.nav.live }));
    await heading(t.routes.screens.live.title);
    expect(router.state.location.pathname).toBe('/live');
  });
});
