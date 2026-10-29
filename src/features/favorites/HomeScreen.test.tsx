// FAV-03 Home: sections (hidden when empty), empty state with shortcuts, card routes, keyboard
// row navigation, "Clear history" (FAV-02 AC3) and the active-list switch.
import 'fake-indexeddb/auto';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { favoritesRepo, historyRepo, itemKey, settingsRepo, wipeAll } from '@/core/db';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import { OTHER, SOURCE, renderScreens, seedCatalog } from './test-utils';

let media: { restore(): void } | undefined;

beforeEach(async () => {
  await seedCatalog();
  await settingsRepo.set('activeSourceId', SOURCE);
});

afterEach(async () => {
  // Unmount first: a mounted screen would re-read the active list while the database is wiped.
  cleanup();
  media?.restore();
  media = undefined;
  forgetActiveSource();
  await wipeAll();
});

function show(path = '/') {
  const view = renderScreens(path);
  media = view.media;
  return view;
}

const live = (id: string, source = SOURCE) => itemKey(source, 'live', id);
const movie = (id: string) => itemKey(SOURCE, 'movie', id);

/** Section headings (h2) in document order. */
const sectionTitles = () =>
  screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const section = (name: string) => screen.getByRole('region', { name });
/** Card names (the artwork fallback repeats the name, hidden from assistive tech). */
const names = (elements: HTMLElement[]) =>
  elements.map((el) => el.querySelector('.card-name')?.textContent);
const row = (name: string) => within(section(name)).getByRole('list', { name });

async function seedAll() {
  await historyRepo.upsert({ itemKey: movie('m1'), positionSec: 600, durationSec: 6000 });
  await historyRepo.upsert({ itemKey: live('c1'), lastWatchedAt: 1 });
  await historyRepo.upsert({ itemKey: live('c2'), lastWatchedAt: 2 });
  await historyRepo.upsert({ itemKey: live('c3'), lastWatchedAt: 3 });
  await favoritesRepo.add(movie('m5'));
}

describe('Home — sections (FAV-03 AC1)', () => {
  it('shows Continue watching, Recent channels and Favorites in that order, as lists', async () => {
    await seedAll();
    show();
    await screen.findByRole('region', { name: 'Continue watching' });
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(sectionTitles()).toEqual(['Continue watching', 'Recent channels', 'Favorites']);
    const recent = row('Recent channels');
    expect(within(recent).getAllByRole('listitem')).toHaveLength(3);
    expect(names(within(recent).getAllByRole('link'))).toEqual([
      'Channel 3',
      'Channel 2',
      'Channel 1',
    ]);
    expect(within(row('Continue watching')).getByRole('link')).toHaveAccessibleName(
      /Movie 1.*10% watched/,
    );
    expect(within(row('Continue watching')).getByTestId('card-progress')).toBeInTheDocument();
  });

  it('hides each empty section', async () => {
    await favoritesRepo.add(movie('m5'));
    show();
    await screen.findByRole('region', { name: 'Favorites' });
    expect(sectionTitles()).toEqual(['Favorites']);
    // No history: nothing to clear.
    expect(screen.queryByRole('button', { name: 'Clear history' })).not.toBeInTheDocument();
  });

  it('"See all" links: recent channels to Live "Recent", favorites to the Favorites screen', async () => {
    await seedAll();
    show();
    await screen.findByRole('region', { name: 'Recent channels' });
    expect(
      within(section('Recent channels')).getByRole('link', { name: 'See all: Recent channels' }),
    ).toHaveAttribute('href', '/live/category/~recent');
    expect(
      within(section('Favorites')).getByRole('link', { name: 'See all: Favorites' }),
    ).toHaveAttribute('href', '/favorites');
  });

  it('cards open the channel in its category, the movie and the series', async () => {
    await historyRepo.upsert({ itemKey: live('c7') });
    await favoritesRepo.add(itemKey(SOURCE, 'series', 's2'), 2);
    await favoritesRepo.add(movie('m3'), 1);
    const { router } = show();
    const recent = await screen.findByRole('list', { name: 'Recent channels' });
    expect(within(recent).getByRole('link', { name: 'Channel 7' })).toHaveAttribute(
      'href',
      `/live/category/10?channel=${encodeURIComponent(live('c7'))}`,
    );
    const favorites = row('Favorites');
    expect(within(favorites).getByRole('link', { name: 'Show 2' })).toHaveAttribute(
      'href',
      '/series/s2',
    );
    await userEvent.setup().click(within(favorites).getByRole('link', { name: 'Movie 3' }));
    expect(router.state.location.pathname).toBe('/movies/m3');
  });
});

describe('Home — empty state (FAV-03 AC3)', () => {
  it('shortcuts to Live, Movies and Series when there is nothing yet', async () => {
    show();
    const empty = await screen.findByRole('region', { name: 'Nothing to show yet' });
    expect(within(empty).getByRole('link', { name: 'Watch Live TV' })).toHaveAttribute(
      'href',
      '/live',
    );
    expect(within(empty).getByRole('link', { name: 'Browse movies' })).toHaveAttribute(
      'href',
      '/movies',
    );
    expect(within(empty).getByRole('link', { name: 'Browse series' })).toHaveAttribute(
      'href',
      '/series',
    );
    expect(sectionTitles()).toEqual(['Nothing to show yet']);
  });

  it('unavailable favorites and finished movies alone leave Home empty', async () => {
    await favoritesRepo.add(movie('gone'));
    await historyRepo.upsert({ itemKey: movie('m1'), positionSec: 5990, durationSec: 6000 });
    show();
    await screen.findByRole('region', { name: 'Nothing to show yet' });
    // The finished movie is still history that can be cleared.
    expect(screen.getByRole('button', { name: 'Clear history' })).toBeInTheDocument();
  });
});

describe('Home — keyboard (a11y)', () => {
  it('a row is one tab stop; arrows, Home and End move between cards', async () => {
    await seedAll();
    show();
    const recent = await screen.findByRole('list', { name: 'Recent channels' });
    const links = within(recent).getAllByRole('link');
    expect(links.map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    const user = userEvent.setup();
    act(() => links[0]!.focus());
    await user.keyboard('{ArrowRight}');
    expect(links[1]).toHaveFocus();
    expect(links.map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{End}');
    expect(links[2]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(links[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(links[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(links[0]).toHaveFocus();
    // Tab leaves the row (to the next section's "See all" link).
    await user.tab();
    expect(within(section('Favorites')).getByRole('link', { name: /See all/ })).toHaveFocus();
  });
});

describe('Home — clear history (FAV-02 AC3)', () => {
  it('asks first; confirming removes recents and progress but keeps favorites', async () => {
    await seedAll();
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Clear history' }));
    let dialog = screen.getByRole('dialog', { name: 'Clear history?' });
    expect(dialog).toHaveTextContent('Your favorites are kept.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await historyRepo.listRecent(SOURCE, 'live')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    dialog = screen.getByRole('dialog', { name: 'Clear history?' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear history' }));
    await waitFor(() => expect(sectionTitles()).toEqual(['Favorites']));
    expect(await screen.findByText('History cleared.')).toBeInTheDocument();
    expect(await favoritesRepo.has(movie('m5'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Clear history' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toHaveFocus(),
    );
  });
});

describe('Home — active list (FAV-01 AC3)', () => {
  it('shows the active list only and reloads when it changes', async () => {
    await seedAll();
    await historyRepo.upsert({ itemKey: live('o1', OTHER) });
    show();
    const recent = await screen.findByRole('list', { name: 'Recent channels' });
    expect(within(recent).queryByRole('link', { name: 'Other channel' })).not.toBeInTheDocument();

    await act(() => setActiveSource(OTHER));
    await waitFor(() => expect(sectionTitles()).toEqual(['Recent channels']));
    expect(names(within(row('Recent channels')).getAllByRole('link'))).toEqual(['Other channel']);
  });
});
