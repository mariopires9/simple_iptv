import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { AppRouter, appRoutes } from './router';

const failures = vi.hoisted(() => ({ render: false, importsToFail: 0 }));

// A screen that throws while rendering (the stack must never reach the UI).
vi.mock('@/features/movies/MovieDetailsScreen', () => ({
  MovieDetailsScreen: () => {
    if (failures.render) throw new Error('boom at /secret/stack/frame.ts:1');
    return <h1>Movie details OK</h1>;
  },
}));

// A lazy chunk that fails to load (e.g. offline after a deploy).
vi.mock('@/features/search/SearchScreen', () => {
  if (failures.importsToFail > 0) {
    failures.importsToFail -= 1;
    throw new Error('Failed to fetch dynamically imported module');
  }
  return { SearchScreen: () => <h1>Search OK</h1> };
});

let media: ReturnType<typeof installMatchMedia> | undefined;

function renderRoute(path: string) {
  media = installMatchMedia({ width: 1400 });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeModeProvider>
      <AppRouter router={router} />
    </ThemeModeProvider>,
  );
  return router;
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

beforeEach(() => {
  clearLogBuffer();
  // React and the logger report the caught error on the console; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  failures.render = false;
  failures.importsToFail = 0;
  vi.restoreAllMocks();
  media?.restore();
  media = undefined;
  await wipeAll();
});

// FND-04 AC5
describe('router — route error boundary', () => {
  it('a screen that throws shows a friendly error inside the AppShell, without the stack', async () => {
    failures.render = true;
    renderRoute('/movies/42');

    await heading('Something went wrong');
    expect(
      screen.getByText('This screen could not be displayed. Try again or go back to Home.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/boom|stack|frame\.ts/);
  });

  it('logs the error once with log.error (route pattern, redacted)', async () => {
    failures.render = true;
    renderRoute('/movies/42');
    await heading('Something went wrong');

    const errors = getLogEntries().filter((e) => e.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Route error');
    expect(errors[0]?.context).toContain('/movies/:movieId');
    expect(errors[0]?.context).toContain('boom');
  });

  it('"Try again" renders the screen again', async () => {
    const user = userEvent.setup();
    failures.render = true;
    const router = renderRoute('/movies/42');
    await heading('Something went wrong');

    failures.render = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await heading('Movie details OK');
    expect(router.state.location.pathname).toBe('/movies/42');
  });

  it('"Go to Home" leaves the failing screen', async () => {
    const user = userEvent.setup();
    failures.render = true;
    const router = renderRoute('/movies/42');
    await heading('Something went wrong');

    await user.click(screen.getByRole('link', { name: 'Go to Home' }));
    await heading('Home');
    expect(router.state.location.pathname).toBe('/');
  });

  it('a lazy chunk that fails to load shows the error state; "Try again" retries the import', async () => {
    const user = userEvent.setup();
    failures.importsToFail = 1;
    renderRoute('/search');

    await heading('Something went wrong');
    expect(getLogEntries().some((e) => e.level === 'error' && e.message === 'Route error')).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await heading('Search OK');
  });
});
