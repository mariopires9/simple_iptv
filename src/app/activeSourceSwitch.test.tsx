// SRC-08 AC0/AC4: the top-bar list selector in the real app routes — keyboard use, "Manage
// lists…", "Add list", and switching the active list re-renders Live with the other list's
// categories without a reload (fake-indexeddb with two lists).
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import { t } from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { ThemeModeProvider } from '@/ui/theme';
import { appRoutes } from './router';

const text = t.lists.selector;

function list(id: string, name: string, createdAt: number): Source {
  return {
    id,
    kind: 'm3u-url',
    name,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncStatus: 'ok',
    stats: { live: 1, movies: 0, series: 0 },
  };
}

async function seed() {
  for (const [id, name, category, createdAt] of [
    ['a', 'Alpha list', 'Alpha news', 1],
    ['b', 'Bravo list', 'Bravo sports', 2],
  ] as const) {
    await sourcesRepo.put(list(id, name, createdAt));
    await catalogRepo.replaceForSource(id, 'live', {
      categories: [{ externalId: `${id}1`, name: category }],
      items: [
        {
          externalId: '1',
          categoryExternalId: `${id}1`,
          name: `${name} channel`,
          streamPath: 'https://streams.example.test/1.m3u8',
        },
      ],
    });
  }
  await settingsRepo.set('activeSourceId', 'a');
}

let media: ReturnType<typeof installMatchMedia> | undefined;

function renderApp(path: string, width = 1400) {
  media = installMatchMedia({ width });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <ThemeModeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeModeProvider>,
  );
  return { router, user: userEvent.setup() };
}

beforeEach(() => setSourcesPresent(true));
afterEach(async () => {
  vi.restoreAllMocks();
  media?.restore();
  media = undefined;
  invalidateSourcesPresence();
  forgetActiveSource();
  await wipeAll();
});

const selector = (name: string) => screen.findByRole('button', { name: text.label(name) });

describe('SRC-08 — top-bar list selector', () => {
  it('keyboard: opens a menu of lists (active checked), arrows move, Enter switches', async () => {
    await seed();
    const { user } = renderApp('/settings');
    const button = await selector('Alpha list');
    expect(within(screen.getByRole('banner')).getByText('Alpha list')).toBeVisible();

    button.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Alpha list', 'Bravo list']);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByRole('menuitem', { name: text.manage })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: text.add })).toBeInTheDocument();

    await waitFor(() => expect(items[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await selector('Bravo list')).toBeInTheDocument();
    expect(await settingsRepo.get('activeSourceId')).toBe('b');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  // Review fix 6: switch first; on failure stay where we are and say so.
  it('a failed switch shows an error and does not leave the current screen', async () => {
    await seed();
    const { user, router } = renderApp('/live/category/a1');
    expect(await screen.findByRole('link', { name: 'Alpha news' })).toBeInTheDocument();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Only the active-list write fails: Live persists its own view state through the same repo
    // (LIV-03), and a blanket `mockRejectedValueOnce` could be consumed by that write instead.
    const realSet = settingsRepo.set.bind(settingsRepo);
    vi.spyOn(settingsRepo, 'set').mockImplementation(((key, value) =>
      key === 'activeSourceId'
        ? Promise.reject(new Error('quota'))
        : realSet(key, value)) as typeof settingsRepo.set);
    await user.click(await selector('Alpha list'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Bravo list' }));

    expect(await screen.findAllByText(t.lists.switchFailed)).not.toHaveLength(0);
    expect(router.state.location.pathname).toBe('/live/category/a1');
    expect(await selector('Alpha list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha news' })).toBeInTheDocument();
    expect(await settingsRepo.get('activeSourceId')).toBe('a');
  });

  it('"Manage lists…" opens My lists', async () => {
    await seed();
    const { user, router } = renderApp('/');
    await user.click(await selector('Alpha list'));
    await user.click(await screen.findByRole('menuitem', { name: text.manage }));
    expect(
      await screen.findByRole('heading', { level: 1, name: t.sources.myLists.title }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/settings/sources');
  });

  it('"Add list" opens the type chooser', async () => {
    await seed();
    const { user } = renderApp('/');
    await user.click(await selector('Alpha list'));
    await user.click(await screen.findByRole('menuitem', { name: text.add }));
    expect(await screen.findByRole('dialog', { name: t.lists.chooser.title })).toBeVisible();
  });

  it('is part of the top bar on mobile too', async () => {
    await seed();
    renderApp('/', 360);
    const button = await selector('Alpha list');
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: button.getAttribute('aria-label') ?? '',
      }),
    ).toBe(button);
  });
});

describe('SRC-08 AC4 — switching re-renders Live with the other list, without a reload', () => {
  it('Live shows the new list categories; the chrome is not re-created', async () => {
    await seed();
    const { user, router } = renderApp('/live');
    expect(await screen.findByRole('link', { name: 'Alpha news' })).toBeInTheDocument();
    const banner = screen.getByRole('banner');
    // Review fixes 5/7/9: the screen reacts to the session store; nothing is remounted.
    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { level: 1, name: t.live.title });

    await user.click(await selector('Alpha list'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Bravo list' }));

    expect(await screen.findByRole('link', { name: 'Bravo sports' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alpha news' })).toBeNull();
    // Same top bar element: the app was not reloaded, only the screen re-rendered.
    expect(screen.getByRole('banner')).toBe(banner);
    expect(screen.getByRole('main')).toBe(main);
    expect(screen.getByRole('heading', { level: 1, name: t.live.title })).toBe(heading);
    expect(router.state.location.pathname).toBe('/live');
  });

  it('from a category / playing channel of the previous list → back to /live (player closed)', async () => {
    await seed();
    const { user, router } = renderApp(
      `/live/category/a1?channel=${encodeURIComponent('a:live:1')}`,
    );
    expect(await screen.findByRole('link', { name: 'Alpha news' })).toBeInTheDocument();
    expect(await screen.findByTestId('live-player')).toBeInTheDocument();

    await user.click(await selector('Alpha list'));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Bravo list' }));

    expect(await screen.findByRole('link', { name: 'Bravo sports' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/live');
    expect(router.state.location.search).toBe('');
    expect(screen.queryByTestId('live-player')).toBeNull();
  });
});
