// TEC-01: every route renders with its feature strings when none is loaded yet (as at startup):
// the routes declare their namespaces, so the dev guard on `t` never fires.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import {
  isMessagesLoaded,
  LAZY_NAMESPACES,
  loadAllMessages,
  t,
  unloadMessagesForTests,
} from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { AppRouter, appRoutes } from './router';

let media: ReturnType<typeof installMatchMedia> | undefined;

beforeEach(() => {
  setSourcesPresent(true);
  unloadMessagesForTests();
});

afterEach(async () => {
  media?.restore();
  media = undefined;
  invalidateSourcesPresence();
  forgetActiveSource();
  await wipeAll();
  await loadAllMessages();
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
}

describe('route strings (TEC-01)', () => {
  it('starts with no feature namespace loaded', () => {
    for (const namespace of LAZY_NAMESPACES) expect(isMessagesLoaded(namespace)).toBe(false);
  });

  it('the top-bar list selector renders with eager strings only (no `sources` load)', async () => {
    await sourcesRepo.put({
      id: 'a',
      kind: 'm3u-url',
      name: 'Alpha list',
      prefs: { liveFormat: 'auto' },
      createdAt: 1,
      lastSyncStatus: 'ok',
      stats: { live: 0, movies: 0, series: 0 },
    });
    await settingsRepo.set('activeSourceId', 'a');
    renderRoute('/series');
    await screen.findByRole('heading', { level: 1 });
    const button = await screen.findByRole('button', {
      name: t.lists.selector.label('Alpha list'),
    });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: t.lists.selector.add }));
    expect(await screen.findByRole('dialog', { name: t.lists.chooser.title })).toBeInTheDocument();
    expect(isMessagesLoaded('sources')).toBe(false);
  });

  it('/live renders without the player strings; they load with the player UI', async () => {
    renderRoute('/live');
    await screen.findByRole('heading', { level: 1 });
    expect(isMessagesLoaded('live')).toBe(true);
    expect(isMessagesLoaded('player')).toBe(false);
    const ui = await import('@/player/ui');
    expect(ui.PlayerView).toBeTypeOf('function');
    await waitFor(() => expect(isMessagesLoaded('player')).toBe(true));
  });

  it.each([
    '/',
    '/live',
    '/live/category/7',
    '/movies',
    '/movies/category/123',
    '/movies/42',
    '/series',
    '/series/77',
    '/favorites',
    '/search',
    '/settings',
    '/settings/privacy',
    '/settings/sources',
    '/settings/sources/add/xtream',
    '/settings/sources/add/m3u-url',
    '/onboarding',
    '/onboarding/xtream',
    '/onboarding/m3u-url',
    '/onboarding/m3u-file',
  ])('%s renders its screen with its strings', async (path) => {
    renderRoute(path);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).not.toHaveTextContent(t.routes.notFound.title);
    expect(screen.queryByText(t.routes.error.message)).toBeNull();
  });

  it.each([
    ['/live', ['live']],
    ['/movies', ['movies']],
    ['/onboarding', ['onboarding']],
    ['/onboarding/xtream', ['sources']],
    ['/series', []],
    ['/search', ['search']],
  ] as const)('%s loads exactly %j with the screen', async (path, namespaces) => {
    renderRoute(path);
    await screen.findByRole('heading', { level: 1 });
    for (const namespace of LAZY_NAMESPACES) {
      expect(isMessagesLoaded(namespace)).toBe(
        (namespaces as readonly string[]).includes(namespace),
      );
    }
  });
});
