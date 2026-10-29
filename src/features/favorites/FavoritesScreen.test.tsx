// FAV-03 AC2 Favorites screen: tabs Channels/Movies/Series of the active list, card routes,
// unavailable favorites with a Remove option (FAV-01 AC2) and the active-list switch (AC3).
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { favoritesRepo, itemKey, settingsRepo, wipeAll } from '@/core/db';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import { OTHER, SOURCE, renderScreens, seedCatalog } from './test-utils';

let media: { restore(): void } | undefined;

beforeEach(async () => {
  await seedCatalog();
  await settingsRepo.set('activeSourceId', SOURCE);
  await favoritesRepo.add(itemKey(SOURCE, 'live', 'c4'), 1);
  await favoritesRepo.add(itemKey(SOURCE, 'live', 'gone'), 2);
  await favoritesRepo.add(itemKey(SOURCE, 'movie', 'm2'), 3);
  await favoritesRepo.add(itemKey(OTHER, 'live', 'o1'), 4);
});

afterEach(async () => {
  // Unmount first: a mounted screen would re-read the active list while the database is wiped.
  cleanup();
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  forgetActiveSource();
  await wipeAll();
});

function show(path = '/favorites') {
  const view = renderScreens(path);
  media = view.media;
  return view;
}

const panelList = (name: string) => screen.findByRole('list', { name });
const cardNames = (list: HTMLElement) =>
  [...list.querySelectorAll('.card-name')].map((el) => el.textContent);

describe('Favorites — tabs (FAV-03 AC2)', () => {
  it('Channels, Movies and Series tabs; Channels first; the tab is kept in the URL', async () => {
    const { router } = show();
    expect(screen.getByRole('heading', { level: 1, name: 'Favorites' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Favorite types' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Channels', 'Movies', 'Series']);
    expect(within(tabs).getByRole('tab', { name: 'Channels' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const channels = await panelList('Channels');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Channels');
    expect(within(channels).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.setup().click(within(tabs).getByRole('tab', { name: 'Movies' }));
    const movies = await panelList('Movies');
    expect(cardNames(movies)).toEqual(['Movie 2']);
    expect(router.state.location.search).toBe('?tab=movies');
  });

  it('arrow keys move between tabs', async () => {
    show();
    await panelList('Channels');
    const user = userEvent.setup();
    act(() => screen.getByRole('tab', { name: 'Channels' }).focus());
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveFocus();
  });

  it('a deep link opens its tab; Series shows "none yet" with a way to browse', async () => {
    show('/favorites?tab=series');
    const empty = await screen.findByRole('region', { name: 'No favorite series yet.' });
    expect(within(empty).getByRole('link', { name: 'Browse series' })).toHaveAttribute(
      'href',
      '/series',
    );
    expect(screen.getByRole('tab', { name: 'Series' })).toHaveAttribute('aria-selected', 'true');
  });

  it('cards link to the channel in its category and to the movie', async () => {
    const { router } = show();
    const channels = await panelList('Channels');
    expect(within(channels).getByRole('link', { name: 'Channel 4' })).toHaveAttribute(
      'href',
      `/live/category/10?channel=${encodeURIComponent(itemKey(SOURCE, 'live', 'c4'))}`,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Movies' }));
    await user.click(within(await panelList('Movies')).getByRole('link', { name: 'Movie 2' }));
    expect(router.state.location.pathname).toBe('/movies/m2');
  });
});

describe('Favorites — unavailable and remove (FAV-01 AC2)', () => {
  it('an item that left the list is "Unavailable" and can be removed', async () => {
    show();
    const channels = await panelList('Channels');
    // Most recently added first.
    expect(cardNames(channels)).toEqual(['Unavailable', 'Channel 4']);
    const unavailable = within(channels).getByTestId('unavailable-favorite');
    expect(within(unavailable).queryByRole('link')).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(
        within(channels).getByRole('button', { name: 'Remove unavailable item from favorites' }),
      );
    await waitFor(() => expect(cardNames(channels)).toEqual(['Channel 4']));
    expect(screen.getByText('Unavailable item removed from favorites')).toBeInTheDocument();
    expect(await favoritesRepo.has(itemKey(SOURCE, 'live', 'gone'))).toBe(false);
    expect(await favoritesRepo.has(itemKey(SOURCE, 'live', 'c4'))).toBe(true);
  });

  it('removing an available favorite; a failed write brings it back and says so', async () => {
    show();
    const channels = await panelList('Channels');
    const user = userEvent.setup();
    vi.spyOn(favoritesRepo, 'remove').mockRejectedValueOnce(new Error('boom'));
    await user.click(
      within(channels).getByRole('button', { name: 'Remove Channel 4 from favorites' }),
    );
    expect(
      await screen.findByText('Could not update your favorites. Try again.'),
    ).toBeInTheDocument();
    expect(cardNames(channels)).toEqual(['Unavailable', 'Channel 4']);

    await user.click(
      within(channels).getByRole('button', { name: 'Remove Channel 4 from favorites' }),
    );
    await waitFor(() => expect(cardNames(channels)).toEqual(['Unavailable']));
    expect(screen.getByText('Channel 4 removed from favorites')).toBeInTheDocument();
    expect(await favoritesRepo.has(itemKey(SOURCE, 'live', 'c4'))).toBe(false);
  });
});

describe('Favorites — active list (FAV-01 AC3)', () => {
  it("shows the active list's favorites and reloads when the list changes", async () => {
    show();
    const channels = await panelList('Channels');
    expect(cardNames(channels)).not.toContain('Other channel');

    await act(() => setActiveSource(OTHER));
    await waitFor(async () =>
      expect(cardNames(await panelList('Channels'))).toEqual(['Other channel']),
    );
  });
});
