import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { App } from './App';
import { getAppRouter, resetAppRouter } from './router';

// QA-04: the onboarding guard's answer is known before the router exists, so a first run starts
// the router on /onboarding directly (no AppShell start screen loaded and then hidden).
let media: ReturnType<typeof installMatchMedia> | undefined;

function renderApp(hash: string, onStarted?: () => void) {
  window.location.hash = hash;
  media = installMatchMedia({ width: 1400 });
  return render(<App onStarted={onStarted} />);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  resetAppRouter();
  invalidateSourcesPresence();
  media?.restore();
  media = undefined;
  window.location.hash = '';
  await wipeAll();
});

describe('App — start-up redirect to onboarding (QA-04)', () => {
  it.each(['', '#/', '#/movies/category/123'])(
    'no sources, start %s → the router starts on /onboarding',
    async (hash) => {
      renderApp(hash);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Welcome to Simple IPTV' }),
      ).toBeInTheDocument();
      expect(window.location.hash).toBe('#/onboarding');
      // The first location the router saw was already the onboarding route: no shell rendered.
      expect(getAppRouter().state.historyAction).toBe('POP');
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    },
  );

  it('no sources, Settings (exempt from the guard) → stays on Settings', async () => {
    renderApp('#/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
  });

  it('with a source → the start location is kept', async () => {
    setSourcesPresent(true);
    renderApp('#/favorites');
    expect(await screen.findByRole('heading', { level: 1, name: 'Favorites' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/favorites');
  });

  it('calls onStarted once the first screen is up', async () => {
    // jsdom has no requestIdleCallback (the 3 s fallback timer would slow the test down).
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
    vi.stubGlobal('cancelIdleCallback', (handle: number) => clearTimeout(handle));
    const onStarted = vi.fn();
    renderApp('', onStarted);
    await screen.findByRole('heading', { level: 1, name: 'Welcome to Simple IPTV' });
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  });
});
