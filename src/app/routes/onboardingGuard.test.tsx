// UX-01: onboarding guard (AC1), the onboarding screen (AC2) and the first-run flow up to Home
// (AC3) on the real route tree, with fake-indexeddb and the synthetic MSW panel.
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen } from '@testing-library/react';
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
import { GUARD_RETRY_MS, isOnboardingExempt } from './onboardingGuard';

const sync = vi.hoisted(() => ({ start: vi.fn(() => Promise.resolve('started' as const)) }));
vi.mock('@/features/sources/sync', () => ({ startInitialSync: sync.start }));

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let media: ReturnType<typeof installMatchMedia> | undefined;

afterEach(async () => {
  // Unmount first: file-level afterEach hooks run before the setup file's cleanup, and a screen
  // still mounted could re-cache "no sources" between the invalidation and the wipe.
  cleanup();
  server.resetHandlers();
  media?.restore();
  media = undefined;
  clearSecrets();
  sync.start.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await wipeAll();
  invalidateSourcesPresence();
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
    ['/settings/privacy', t.settings.privacy.title],
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
    await heading(t.settings.privacy.title);
    expect(router.state.location.pathname).toBe('/settings/privacy');
  });

  it('m3uUrl option → the add-M3U-URL screen (SRC-05) with a way back', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/onboarding');
    await heading(ONBOARDING);
    await user.click(
      screen.getByRole('link', { name: startsWith(t.onboarding.options.m3uUrl.title) }),
    );
    await heading(t.sources.addM3uUrl.title);
    expect(router.state.location.pathname).toBe('/onboarding/m3u-url');
    await user.click(screen.getByRole('link', { name: t.sources.addM3uUrl.back }));
    await heading(ONBOARDING);
  });

  it.each([['m3uFile', t.sources.comingSoon.m3uFile]] as const)(
    '%s option → "coming soon" with a way back',
    async (id, text) => {
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
    },
  );
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

// Review findings 1, 2 and 7: the first check keeps the shell visible, a failed check is not
// latched, and an invalidation while the check is in flight never leaves the guard stuck.
describe('UX-01 — guard edge cases', () => {
  const nav = () => screen.queryByRole('navigation', { name: 'Main navigation' });

  function deferredList() {
    let resolve: (sources: []) => void = () => undefined;
    const promise = new Promise<[]>((r) => {
      resolve = r;
    });
    return { promise, resolve: (v: []) => resolve(v) };
  }

  it('while the first check runs: shell chrome visible, no screen; then the redirect', async () => {
    const pending = deferredList();
    vi.spyOn(sourcesRepo, 'list').mockReturnValueOnce(pending.promise);
    const router = renderRoute('/live');
    expect(nav()).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(router.state.location.pathname).toBe('/live');

    await act(async () => pending.resolve([]));
    await heading(ONBOARDING);
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('a failed check lets the user through, and the next navigation checks again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(sourcesRepo, 'list').mockRejectedValueOnce(new Error('db down'));
    const user = userEvent.setup();
    const router = renderRoute('/');
    await heading(t.routes.screens.home.title);

    await user.click(screen.getByRole('link', { name: t.nav.live }));
    await heading(ONBOARDING);
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('after a failed check, a background retry honours the answer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(sourcesRepo, 'list').mockRejectedValueOnce(new Error('db down'));
    const router = renderRoute('/');
    await heading(t.routes.screens.home.title);

    await act(async () => {
      vi.advanceTimersByTime(GUARD_RETRY_MS);
    });
    await heading(ONBOARDING);
    expect(router.state.location.pathname).toBe('/onboarding');
  });

  it('an invalidation while the first check is in flight re-checks instead of hanging', async () => {
    const stale = deferredList();
    vi.spyOn(sourcesRepo, 'list').mockReturnValueOnce(stale.promise);
    const router = renderRoute('/');
    await act(async () => invalidateSourcesPresence());
    // The guard re-checked with a fresh read (no sources) and redirects, stale read still pending.
    await heading(ONBOARDING);
    expect(router.state.location.pathname).toBe('/onboarding');
    await act(async () => stale.resolve([]));
  });
});
