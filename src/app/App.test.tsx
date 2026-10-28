import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createHashRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { App } from './App';
import { resetAppRouter } from './router';

// Pass-through spy: counts the routers the app creates.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, createHashRouter: vi.fn(actual.createHashRouter) };
});

let media: ReturnType<typeof installMatchMedia> | undefined;

function renderApp(hash: string, width = 1400) {
  window.location.hash = hash;
  media = installMatchMedia({ width });
  return render(<App />);
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

afterEach(async () => {
  resetAppRouter();
  vi.mocked(createHashRouter).mockClear();
  media?.restore();
  media = undefined;
  window.location.hash = '';
  await wipeAll();
});

describe('App — router lifetime', () => {
  it('creates a single hash router under StrictMode (double render, effects re-run)', async () => {
    window.location.hash = '#/favorites';
    media = installMatchMedia({ width: 1400 });
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await heading('Favorites');
    expect(createHashRouter).toHaveBeenCalledTimes(1);

    // A remount reuses the same router instead of creating another popstate listener.
    unmount();
    render(<App />);
    await heading('Favorites');
    expect(createHashRouter).toHaveBeenCalledTimes(1);
  });
});

// jsdom reports navigator.languages = ['en-US'], so `t` resolves to the base locale (en).
describe('App (hash router)', () => {
  it('renders the shell and Home at the root', async () => {
    renderApp('');
    await heading('Home');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByText('Simple IPTV')).toBeInTheDocument();
  });

  // FND-04 AC1: GitHub Pages only ever serves index.html; the route lives in the hash.
  it('deep link #/movies/category/123 opens the movies screen for that category', async () => {
    renderApp('#/movies/category/123');
    await heading('Movies');
    expect(screen.getByText('Category: 123')).toBeInTheDocument();
    expect(screen.getByRole('link', { current: 'page' })).toHaveAccessibleName('Movies');
  });

  it('nav links are hash URLs and update window.location.hash', async () => {
    const user = userEvent.setup();
    renderApp('');
    await heading('Home');
    const live = screen.getByRole('link', { name: 'Live' });
    expect(live).toHaveAttribute('href', '#/live');

    await user.click(live);
    await heading('Live TV');
    expect(window.location.hash).toBe('#/live');
  });

  // FND-04 AC4: browser / Android back walks the history of screens.
  it('browser back returns to the previous screen', async () => {
    const user = userEvent.setup();
    renderApp('#/movies');
    await heading('Movies');
    await user.click(screen.getByRole('link', { name: 'Series' }));
    await heading('Series');

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });
    await heading('Movies');
    expect(window.location.hash).toBe('#/movies');
  });

  it('unknown hash route shows "Page not found"', async () => {
    renderApp('#/this/does/not/exist');
    await heading('Page not found');
  });
});
