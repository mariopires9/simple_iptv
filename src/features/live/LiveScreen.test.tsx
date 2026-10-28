import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  categoryKey,
  favoritesRepo,
  itemKey,
  settingsRepo,
  wipeAll,
  type Channel,
  type Favorite,
} from '@/core/db';
import { CHANNEL_ROW_HEIGHT } from '@/ui/state';
import { MAX_PAGES, PAGE_SIZE } from './pageCache';
import {
  EMPTY_SOURCE_ID,
  SOURCE_ID,
  TOTAL_CHANNELS,
  installScrollMetrics,
  renderLive,
  seedCatalog,
} from './test-utils';

const key = (n: number) => itemKey(SOURCE_ID, 'live', String(n));

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeAll(async () => {
  await seedCatalog();
}, 60_000);

afterAll(async () => {
  await wipeAll();
});

beforeEach(() => {
  restoreScroll = installScrollMetrics();
});

afterEach(async () => {
  restoreScroll();
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  // Favorites and the active source are the only state the tests change.
  const favorites: Favorite[] = await favoritesRepo.list(SOURCE_ID, 'live');
  await Promise.all(favorites.map((f) => favoritesRepo.remove(f.itemKey)));
  await settingsRepo.set('activeSourceId', SOURCE_ID);
});

function show(path?: string, width?: number) {
  const view = renderLive(path, width);
  media = view.media;
  return view;
}

const listbox = (name: string | RegExp = /^Channels in/) =>
  screen.findByRole('listbox', { name }, { timeout: 5000 });
const options = () => screen.getAllByRole('option');
const option = (posinset: number) =>
  options().find((o) => o.getAttribute('aria-posinset') === String(posinset));
const activeOption = (list: HTMLElement) => {
  const id = list.getAttribute('aria-activedescendant');
  return id === null ? null : document.getElementById(id);
};

describe('LiveScreen — categories (AC1)', () => {
  it('lists Favorites, Recent, All, then the source categories in their original order', async () => {
    show('/live');
    await listbox();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Favorites', 'Recent', 'All', 'News', 'Sports', 'Mega', 'Empty']);
    // `/live` selects "All".
    expect(within(nav).getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Live TV' })).toBeInTheDocument();
  });

  it('a deep link to /live/category/:categoryId selects that category', async () => {
    show('/live/category/20');
    const list = await listbox('Channels in Sports');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getByRole('link', { name: 'Sports' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await within(list).findByText('Channel 6');
    expect(options()).toHaveLength(5);
    expect(options()[0]).toHaveAttribute('aria-setsize', '5');
  });

  it('clicking a category navigates to its route', async () => {
    const { router } = show('/live');
    await listbox();
    await userEvent.click(screen.getByRole('link', { name: 'News' }));
    expect(router.state.location.pathname).toBe('/live/category/10');
    await listbox('Channels in News');
  });

  it('an unknown category shows "Category not found" with a way back to All', async () => {
    show('/live/category/nope');
    expect(await screen.findByRole('heading', { name: 'Category not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all channels' })).toHaveAttribute(
      'href',
      '/live/category/~all',
    );
  });

  it('mobile shows the categories as horizontal chips; desktop as a side list', async () => {
    const mobile = show('/live', 400);
    await listbox();
    let nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(7);
    expect(screen.queryByText('Select a channel to watch it here.')).toBeNull();
    mobile.unmount();
    media?.restore();

    show('/live', 1400);
    await listbox();
    nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(0);
    expect(nav.querySelectorAll('.MuiListItemButton-root')).toHaveLength(7);
    // Video panel placeholder (PLY-02).
    expect(screen.getByText('Select a channel to watch it here.')).toBeInTheDocument();
  });
});

describe('LiveScreen — virtualised list with paging (AC2)', () => {
  it(`renders only the visible rows of ${TOTAL_CHANNELS} channels`, async () => {
    show('/live');
    const list = await listbox('Channels in All');
    await within(list).findByText('Channel 1');
    expect(options().length).toBeLessThanOrEqual(40);
    expect(options()[0]).toHaveAttribute('aria-setsize', String(TOTAL_CHANNELS));
    expect(options()[0]).toHaveAttribute('aria-posinset', '1');
  });

  it('reads pages of at most PAGE_SIZE rows, only around the viewport', async () => {
    const spy = vi.spyOn(catalogRepo, 'listByCategory');
    show('/live');
    const list = await listbox('Channels in All');
    await within(list).findByText('Channel 1');
    const rowsRead = () =>
      spy.mock.calls.reduce((sum, [, , page]) => sum + (page?.limit ?? Infinity), 0);
    expect(rowsRead()).toBeLessThanOrEqual(PAGE_SIZE);

    // Scroll down: the rows there are loaded on demand from IndexedDB (category "Mega").
    // (Not further: fake-indexeddb's cursor `advance` is quadratic, so deep offsets take tens of
    // seconds in jsdom; the End-key test below covers the far end with a stubbed page reader.)
    await act(async () => {
      list.scrollTo({ top: 1_000 * CHANNEL_ROW_HEIGHT });
    });
    await within(list).findByText('Channel 1001', undefined, { timeout: 10_000 });
    expect(options().length).toBeLessThanOrEqual(40);
    expect(spy).toHaveBeenCalledWith(
      'live',
      expect.stringContaining(':cat:30'),
      // Global page 5 (rows 1 000–1 199) = "Mega" rows 990… (News and Sports hold 10).
      { offset: 990, limit: PAGE_SIZE },
    );
    for (const [, , page] of spy.mock.calls) expect(page?.limit).toBeLessThanOrEqual(PAGE_SIZE);
    // A few pages, never the whole category.
    expect(rowsRead()).toBeLessThanOrEqual(MAX_PAGES * PAGE_SIZE);
  });
});

describe('LiveScreen — logos (AC3)', () => {
  it('shows the logo with fixed size and lazy loading, and initials when it fails', async () => {
    show('/live');
    const list = await listbox('Channels in All');
    const first = await within(list).findByText('Channel 1');
    const row = first.closest<HTMLElement>('[role="option"]');
    if (!row) throw new Error('no row');
    const img = row.querySelector('img');
    if (!img) throw new Error('no img');
    expect(img).toHaveAttribute('src', 'https://logos.example/1.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('width', '40');
    expect(img).toHaveAttribute('height', '40');
    expect(img).toHaveAttribute('alt', '');

    fireEvent.error(img);
    expect(row.querySelector('img')).toBeNull();
    expect(within(row).getByTestId('channel-initials')).toHaveTextContent('C1');
    // Channels without a logo show initials straight away.
    const second = option(2);
    expect(second && within(second).getByTestId('channel-initials')).toBeTruthy();
  });
});

/**
 * Serves "Mega" pages without IndexedDB (same rows as the seeded ones): fake-indexeddb's cursor
 * `advance` is quadratic, so reading offset ~20 000 would take minutes in jsdom.
 */
function stubDeepPages() {
  const real = catalogRepo.listByCategory.bind(catalogRepo);
  const mega = categoryKey(SOURCE_ID, 'live', '30');
  vi.spyOn(catalogRepo, 'listByCategory').mockImplementation((async (
    type: 'live',
    catKey: string,
    page: { offset?: number; limit?: number } = {},
  ) => {
    if (catKey !== mega) return real(type, catKey, page);
    const { offset = 0, limit = PAGE_SIZE } = page;
    const count = Math.max(0, Math.min(limit, TOTAL_CHANNELS - 10 - offset));
    return Array.from({ length: count }, (_, i): Channel => {
      const n = offset + i + 11;
      return {
        key: key(n),
        sourceId: SOURCE_ID,
        type: 'live',
        externalId: String(n),
        categoryKey: mega,
        name: `Channel ${n}`,
        nameNorm: `channel ${n}`,
        number: n,
        order: n - 1,
        streamPath: `${n}.ts`,
      };
    });
  }) as typeof catalogRepo.listByCategory);
}

describe('LiveScreen — keyboard (AC4)', () => {
  async function focusedList() {
    show('/live');
    const list = await listbox('Channels in All');
    await within(list).findByText('Channel 1');
    list.focus();
    return list;
  }

  it('is a listbox with one tab stop and aria-activedescendant', async () => {
    const list = await focusedList();
    expect(list).toHaveAttribute('tabindex', '0');
    expect(activeOption(list)).toBe(option(1));
    expect(option(1)).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown/ArrowUp/Home/End move the selection', async () => {
    stubDeepPages();
    const user = userEvent.setup();
    const list = await focusedList();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(activeOption(list)).toHaveAttribute('aria-posinset', '3');
    await user.keyboard('{ArrowUp}');
    expect(activeOption(list)).toHaveAttribute('aria-posinset', '2');
    await user.keyboard('{End}');
    expect(activeOption(list)).toHaveAttribute('aria-posinset', String(TOTAL_CHANNELS));
    expect(await within(list).findByText(`Channel ${TOTAL_CHANNELS}`)).toBeInTheDocument();
    expect(options().length).toBeLessThanOrEqual(40);
    await user.keyboard('{Home}');
    expect(activeOption(list)).toHaveAttribute('aria-posinset', '1');
    await user.keyboard('{ArrowUp}');
    expect(activeOption(list)).toHaveAttribute('aria-posinset', '1');
  });

  it('Enter plays the selected channel (route ?channel=<key>)', async () => {
    const user = userEvent.setup();
    const { router } = show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(router.state.location.pathname).toBe('/live/category/10');
    expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(2));
    await waitFor(() => expect(option(2)).toHaveAttribute('data-playing', 'true'));
  });

  it('clicking a row plays it', async () => {
    const { router } = show('/live/category/20');
    const list = await listbox('Channels in Sports');
    await userEvent.click(await within(list).findByText('Channel 7'));
    expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(7));
  });

  it('F toggles the favourite: optimistic, persisted and announced', async () => {
    const user = userEvent.setup();
    show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('{ArrowDown}f');
    const status = screen.getByText('Channel 2 added to favorites');
    expect(status).toHaveAttribute('role', 'status');
    expect(within(option(2) as HTMLElement).getByText(', Favorite')).toBeInTheDocument();
    await waitFor(async () => expect(await favoritesRepo.has(key(2))).toBe(true));

    await user.keyboard('F');
    expect(screen.getByText('Channel 2 removed from favorites')).toBeInTheDocument();
    await waitFor(async () => expect(await favoritesRepo.has(key(2))).toBe(false));
  });

  it('the star toggles the favourite with the mouse, and Favorites lists it', async () => {
    const user = userEvent.setup();
    const { router } = show('/live/category/10');
    const list = await listbox('Channels in News');
    const row = (await within(list).findByText('Channel 3')).closest<HTMLElement>(
      '[role="option"]',
    );
    const star = row?.querySelector('[data-action="favorite"]');
    if (!star) throw new Error('no star');
    await user.click(star);
    expect(router.state.location.search).toBe('');
    await waitFor(async () => expect(await favoritesRepo.has(key(3))).toBe(true));

    await user.click(screen.getByRole('link', { name: 'Favorites' }));
    const favorites = await listbox('Channels in Favorites');
    expect(await within(favorites).findByText('Channel 3')).toBeInTheDocument();
    expect(options()).toHaveLength(1);
  });

  it('rolls back and announces when saving the favourite fails', async () => {
    vi.spyOn(favoritesRepo, 'add').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('f');
    expect(await screen.findByText("Couldn't update favorites for Channel 1")).toBeInTheDocument();
    expect(within(option(1) as HTMLElement).queryByText(', Favorite')).toBeNull();
  });
});

describe('LiveScreen — review fixes', () => {
  it("keeps the active row's page while scrolling 2 000 rows away (read once; Enter works)", async () => {
    stubDeepPages();
    const spy = vi.mocked(catalogRepo.listByCategory);
    const user = userEvent.setup();
    const { router } = show('/live');
    const list = await listbox('Channels in All');
    await within(list).findByText('Channel 1');
    list.focus();
    // More than MAX_PAGES pages away from the active row (0), one page at a time.
    for (let row = PAGE_SIZE; row <= 2_000; row += PAGE_SIZE) {
      await act(async () => {
        list.scrollTo({ top: row * CHANNEL_ROW_HEIGHT });
      });
      await within(list).findByText(`Channel ${row + 1}`, undefined, { timeout: 10_000 });
    }
    expect(Math.ceil(2_000 / PAGE_SIZE) + 1).toBeGreaterThan(MAX_PAGES);
    const news = categoryKey(SOURCE_ID, 'live', '10');
    expect(
      spy.mock.calls.filter(([, catKey, page]) => catKey === news && (page?.offset ?? 0) === 0),
    ).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(1));
    await user.keyboard('f');
    expect(screen.getByText('Channel 1 added to favorites')).toBeInTheDocument();
    await waitFor(async () => expect(await favoritesRepo.has(key(1))).toBe(true));
  }, 30_000);

  it('selecting channels replaces the history entry instead of pushing one per channel', async () => {
    const user = userEvent.setup();
    const { router } = show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(new URLSearchParams(router.state.location.search).get('channel')).toBe(key(2));
  });

  it('"Favorites" drops a removed channel, and shows the empty state after the last one', async () => {
    await favoritesRepo.add(key(1), 1);
    await favoritesRepo.add(key(2), 2);
    const user = userEvent.setup();
    show(`/live/category/~favorites`);
    const list = await listbox('Channels in Favorites');
    await within(list).findByText('Channel 2');
    expect(options()).toHaveLength(2);
    list.focus();
    await user.keyboard('f');
    await waitFor(() => expect(screen.queryByText('Channel 2')).toBeNull());
    expect(options()).toHaveLength(1);
    const again = await listbox('Channels in Favorites');
    again.focus();
    await user.keyboard('f');
    expect(
      await screen.findByRole('heading', { name: 'No favorite channels yet' }),
    ).toBeInTheDocument();
  });

  it('rolls back to the confirmed state when add and then remove both fail', async () => {
    const pending: { reject: (e: Error) => void }[] = [];
    const deferred = () =>
      new Promise<never>((_, reject) => {
        pending.push({ reject });
      });
    vi.spyOn(favoritesRepo, 'add').mockImplementation(deferred);
    vi.spyOn(favoritesRepo, 'remove').mockImplementation(deferred);
    const user = userEvent.setup();
    show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('fF'); // add, then remove, both in flight
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[0]?.reject(new Error('quota'));
      pending[1]?.reject(new Error('quota'));
    });
    expect(await screen.findByText("Couldn't update favorites for Channel 1")).toBeInTheDocument();
    expect(within(option(1) as HTMLElement).queryByText(', Favorite')).toBeNull();
  });

  it('a failed remove after a successful add keeps the channel a favourite', async () => {
    vi.spyOn(favoritesRepo, 'remove').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    show('/live/category/10');
    const list = await listbox('Channels in News');
    await within(list).findByText('Channel 1');
    list.focus();
    await user.keyboard('f');
    await waitFor(async () => expect(await favoritesRepo.has(key(1))).toBe(true));
    await user.keyboard('F');
    expect(await screen.findByText("Couldn't update favorites for Channel 1")).toBeInTheDocument();
    expect(within(option(1) as HTMLElement).getByText(', Favorite')).toBeInTheDocument();
  });
});

describe('LiveScreen — states (AC5)', () => {
  it('an empty category shows the empty state', async () => {
    show('/live/category/40');
    expect(
      await screen.findByRole('heading', { name: 'This category is empty.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all channels' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Favorites and Recent have their own empty states', async () => {
    const view = show(`/live/category/~favorites`);
    expect(
      await screen.findByRole('heading', { name: 'No favorite channels yet' }),
    ).toBeInTheDocument();
    view.unmount();
    media?.restore();
    show(`/live/category/~recent`);
    expect(
      await screen.findByRole('heading', { name: 'No recent channels yet' }),
    ).toBeInTheDocument();
  });

  it('without activeSourceId, falls back to the first source', async () => {
    await settingsRepo.remove('activeSourceId');
    show('/live');
    // The first source (EMPTY_SOURCE_ID) has no channels.
    expect(
      await screen.findByRole('heading', { name: 'This category is empty.' }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(EMPTY_SOURCE_ID).toBe('src0');
  });
});
