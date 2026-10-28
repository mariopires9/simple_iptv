import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { AppRouter, appRoutes } from './router';

let media: ReturnType<typeof installMatchMedia> | undefined;

function renderRoute(path: string, width = 1400) {
  media = installMatchMedia({ width });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeModeProvider>
      <AppRouter router={router} />
    </ThemeModeProvider>,
  );
  return router;
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
const mainNav = () => screen.queryByRole('navigation', { name: 'Main navigation' });

afterEach(async () => {
  media?.restore();
  media = undefined;
  await wipeAll();
});

// FND-04 AC1: every route renders its screen (lazy), including route params.
describe('router — routes', () => {
  it.each([
    ['/', 'Home', null],
    ['/live', 'Live TV', null],
    ['/live/category/7', 'Live TV', 'Category: 7'],
    ['/movies', 'Movies', null],
    ['/movies/category/123', 'Movies', 'Category: 123'],
    ['/movies/42', 'Movie details', 'Item: 42'],
    ['/series', 'Series', null],
    ['/series/category/5', 'Series', 'Category: 5'],
    ['/series/77', 'Series details', 'Item: 77'],
    ['/favorites', 'Favorites', null],
    ['/search', 'Search', null],
    ['/settings', 'Settings', null],
    ['/settings/sources', 'My lists', null],
  ])('%s renders "%s" inside the AppShell', async (path, title, param) => {
    renderRoute(path);
    const h1 = await heading(title);
    expect(within(screen.getByRole('main')).getByText(title)).toBe(h1);
    if (param) expect(screen.getByText(param)).toBeInTheDocument();
    expect(mainNav()).toBeInTheDocument();
  });

  it('/onboarding renders full screen, without the AppShell navigation', async () => {
    renderRoute('/onboarding');
    await heading('Welcome');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(mainNav()).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('renders the AppShell while the first lazy screen loads (no blank page)', () => {
    renderRoute('/movies');
    expect(mainNav()).toBeInTheDocument();
  });

  // React Router mutates `lazy` objects in place: shared route objects would break the second
  // router (StrictMode creates the router twice in development).
  it('every lazy route uses the function form, so several routers can share appRoutes', () => {
    const walk = (routes: RouteObject[]): RouteObject[] =>
      routes.flatMap((r) => [r, ...walk(r.children ?? [])]);
    const lazyRoutes = walk(appRoutes).filter((r) => r.lazy !== undefined);
    expect(lazyRoutes.length).toBeGreaterThanOrEqual(14);
    for (const route of lazyRoutes) expect(typeof route.lazy).toBe('function');
  });

  it('a second router over the same routes still renders the screens', async () => {
    renderRoute('/series/1');
    await heading('Series details');
    cleanup();
    renderRoute('/series/2');
    await heading('Series details');
    expect(screen.getByText('Item: 2')).toBeInTheDocument();
  });
});

// FND-04 AC3
describe('router — not found', () => {
  it.each(['/nope', '/movies/42/extra', '/live/category/1/extra', '/series/category/1/x'])(
    '%s shows "Page not found" with a link to Home',
    async (path) => {
      const user = userEvent.setup();
      const router = renderRoute(path);
      await heading('Page not found');
      expect(mainNav()).toBeInTheDocument();

      await user.click(screen.getByRole('link', { name: 'Go to Home' }));
      await heading('Home');
      expect(router.state.location.pathname).toBe('/');
    },
  );

  // Without the explicit routes, `/movies/category` would render the details of movie "category".
  it.each([
    ['/movies/category', '/movies', 'Movies'],
    ['/series/category', '/series', 'Series'],
    ['/live/category', '/live', 'Live TV'],
    ['/movies/category/', '/movies', 'Movies'],
  ])('%s (no id) redirects to the list %s', async (path, target, title) => {
    const router = renderRoute(path);
    await heading(title);
    expect(router.state.location.pathname).toBe(target);
    expect(screen.queryByText(/^Item:/)).toBeNull();
  });

  it('paths match case-insensitively and the nav follows (/Movies/category/1)', async () => {
    renderRoute('/Movies/category/1');
    await heading('Movies');
    expect(screen.getByText('Category: 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('Movies');
  });
});

// Review finding 4: new screens start at the top; back restores the previous position.
describe('router — scroll restoration', () => {
  it('scrolls to the top on forward navigation and restores the position on back', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    window.sessionStorage.clear();
    const router = renderRoute('/movies');
    await heading('Movies');

    // The user scrolled down the movies list.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    scrollTo.mockClear();
    await user.click(screen.getByRole('link', { name: 'Series' }));
    await heading('Series');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    scrollTo.mockClear();
    await act(() => router.navigate(-1));
    await heading('Movies');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640);

    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});

// FND-04 AC4
describe('router — history', () => {
  it('back returns to the previous screen, forward goes again', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/');
    await heading('Home');

    await user.click(screen.getByRole('link', { name: 'Movies' }));
    await heading('Movies');
    await user.click(screen.getByRole('link', { name: 'Live' }));
    await heading('Live TV');

    await act(() => router.navigate(-1));
    await heading('Movies');
    expect(router.state.location.pathname).toBe('/movies');
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('Movies');

    await act(() => router.navigate(-1));
    await heading('Home');
    await act(() => router.navigate(1));
    await heading('Movies');
  });

  it('clicking the current destination does not stack history entries', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/movies');
    await heading('Movies');
    await user.click(screen.getByRole('link', { name: 'Movies' }));
    await user.click(screen.getByRole('link', { name: 'Movies' }));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
