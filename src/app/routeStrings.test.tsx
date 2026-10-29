// TEC-01: every route renders with its feature strings when none is loaded yet (as at startup):
// the routes declare their namespaces, so the dev guard on `t` never fires.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
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

  // First render of the shell in this file: the selector's `React.lazy` loads (once per module).
  it('the top-bar list selector loads the sources strings with its chunk', async () => {
    renderRoute('/series');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(isMessagesLoaded('sources')).toBe(true));
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
    ['/live', ['live', 'player']],
    ['/movies', ['movies', 'player']],
    ['/onboarding', ['onboarding']],
    ['/onboarding/xtream', ['sources']],
  ] as const)('%s loads %j with the screen', async (path, namespaces) => {
    renderRoute(path);
    await screen.findByRole('heading', { level: 1 });
    for (const namespace of namespaces) expect(isMessagesLoaded(namespace)).toBe(true);
  });
});
