import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  historyRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type CatalogItemInput,
} from '@/core/db';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import { clearBrowseState } from './browseState';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { installScrollMetrics, m3uSource, renderMovies } from './test-utils';

const SOURCE = 'src1';
const OTHER = 'src2';
const MEGA = 10_000;

/** Action: 5 small movies with varied fields; Mega: 10 000 plain movies; Empty: none. */
const ACTION: CatalogItemInput<'movie'>[] = [
  {
    externalId: 'a1',
    categoryExternalId: '10',
    name: 'Zulu Dawn',
    year: 1979,
    rating: 6.1,
    addedAt: 3_000,
    poster: 'https://img.example.test/zulu.jpg',
    streamPath: '',
    streamUrl: 'https://cdn.example.test/a1.mp4',
  },
  {
    externalId: 'a2',
    categoryExternalId: '10',
    name: 'alpha Strike',
    rating: 8.4,
    addedAt: 1_000,
    streamPath: '',
    streamUrl: 'https://cdn.example.test/a2.mp4',
  },
  {
    externalId: 'a3',
    categoryExternalId: '10',
    name: 'Écran Total',
    year: 2020,
    addedAt: 5_000,
    poster: 'javascript:alert(1)',
    streamPath: '',
    streamUrl: 'https://cdn.example.test/a3.mp4',
  },
  {
    externalId: 'a4',
    categoryExternalId: '10',
    name: 'Movie 10',
    rating: 7,
    streamPath: '',
    streamUrl: 'https://cdn.example.test/a4.mp4',
  },
  {
    externalId: 'a5',
    categoryExternalId: '10',
    name: 'Movie 9',
    addedAt: 4_000,
    streamPath: '',
    streamUrl: 'https://cdn.example.test/a5.mp4',
  },
];

async function seed() {
  await sourcesRepo.put(m3uSource(SOURCE, 'Test list', 1));
  await sourcesRepo.put(m3uSource(OTHER, 'Other list', 2));
  const mega: CatalogItemInput<'movie'>[] = Array.from({ length: MEGA }, (_, i) => ({
    externalId: String(i + 1),
    categoryExternalId: '20',
    name: `Film ${i + 1}`,
    streamPath: '',
    streamUrl: `https://cdn.example.test/${i + 1}.mp4`,
  }));
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [
      { externalId: '10', name: 'Action' },
      { externalId: '20', name: 'Mega' },
      { externalId: '30', name: 'Empty' },
    ],
    items: [...ACTION, ...mega],
  });
  await catalogRepo.replaceForSource(OTHER, 'movie', {
    // The synthetic "uncategorized" category the providers create for items without a valid
    // category (stored nameless, localised by the UI) — review #2.
    categories: [
      { externalId: '1', name: 'Docs' },
      { externalId: 'uncategorized', name: '' },
    ],
    items: [
      { externalId: 'd1', categoryExternalId: '1', name: 'Deep Sea', streamPath: '' },
      { externalId: 'd2', categoryExternalId: '1', name: 'Desert', streamPath: '' },
      { externalId: 'o1', categoryExternalId: 'uncategorized', name: 'Orphan', streamPath: '' },
    ],
  });
  await settingsRepo.set('activeSourceId', SOURCE);
}

let restoreScroll: () => void;
let media: { restore(): void } | undefined;

beforeAll(async () => {
  await seed();
}, 60_000);

afterAll(async () => {
  await wipeAll();
});

beforeEach(() => {
  restoreScroll = installScrollMetrics();
});

afterEach(async () => {
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  restoreScroll();
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  forgetActiveSource();
  clearProjectionCache();
  clearBrowseState();
  await settingsRepo.set('activeSourceId', SOURCE);
});

function show(path?: string, width?: number) {
  const view = renderMovies(path, width);
  media = view.media;
  return view;
}

const grid = (name: string | RegExp = /^Movies in/) =>
  screen.findByRole('grid', { name }, { timeout: 5000 });
const cells = () => screen.getAllByRole('gridcell');
/** Titles of the loaded cards, in grid order. */
const titles = (g: HTMLElement) =>
  within(g)
    .getAllByRole('link')
    .map((l) => l.querySelector('.poster-title')?.textContent);

describe('MoviesScreen — categories (VOD-01 AC1)', () => {
  it('lists All, then the source categories in their original order', async () => {
    show('/movies');
    await grid('Movies in All');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['All', 'Action', 'Mega', 'Empty']);
    expect(within(nav).getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Movies' })).toBeInTheDocument();
  });

  it('a deep link to /movies/category/:categoryId selects that category', async () => {
    show('/movies/category/10');
    const g = await grid('Movies in Action');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getByRole('link', { name: 'Action' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await within(g).findByText('Zulu Dawn');
    expect(cells()).toHaveLength(5);
  });

  it('clicking a category navigates to its route', async () => {
    const { router } = show('/movies');
    await grid();
    await userEvent.click(screen.getByRole('link', { name: 'Action' }));
    expect(router.state.location.pathname).toBe('/movies/category/10');
    await grid('Movies in Action');
  });

  it('an unknown category shows "Category not found" with a way back to All', async () => {
    show('/movies/category/nope');
    expect(await screen.findByRole('heading', { name: 'Category not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all movies' })).toHaveAttribute(
      'href',
      '/movies',
    );
  });

  it('"Show all movies" keeps the sort (review #6)', async () => {
    show('/movies/category/nope?sort=name');
    expect(await screen.findByRole('link', { name: 'Show all movies' })).toHaveAttribute(
      'href',
      '/movies?sort=name',
    );
  });

  it('movies without a category are in "All" and in a localised "Uncategorized" (review #2)', async () => {
    await settingsRepo.set('activeSourceId', OTHER);
    show('/movies');
    const g = await grid('Movies in All');
    expect(await within(g).findByRole('link', { name: 'Orphan' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Uncategorized' }));
    const own = await grid('Movies in Uncategorized');
    expect(titles(own)).toEqual(['Orphan']);
  });

  it('an empty category says so', async () => {
    show('/movies/category/30');
    expect(
      await screen.findByRole('heading', { name: 'This category is empty.' }),
    ).toBeInTheDocument();
  });

  it('mobile shows the categories as chips and a 3-column grid', async () => {
    show('/movies/category/20', 400);
    const g = await grid('Movies in Mega');
    expect(g).toHaveAttribute('aria-colcount', '3');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(4);
  });

  it('tablet shows a side list and 4–6 columns', async () => {
    show('/movies/category/20', 800);
    const g = await grid('Movies in Mega');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(0);
    expect(nav.querySelector('ul')).not.toBeNull();
    expect(Number(g.getAttribute('aria-colcount'))).toBeGreaterThanOrEqual(4);
    expect(Number(g.getAttribute('aria-colcount'))).toBeLessThanOrEqual(6);
  });
});

describe('MoviesScreen — virtualised grid (VOD-01 AC1)', () => {
  it('10 000 movies: only a few rows of cells are in the DOM', async () => {
    show('/movies/category/20');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    const columns = Number(g.getAttribute('aria-colcount'));
    expect(columns).toBeGreaterThanOrEqual(6);
    expect(columns).toBeLessThanOrEqual(8);
    expect(g).toHaveAttribute('aria-rowcount', String(Math.ceil(MEGA / columns)));
    expect(cells().length).toBeLessThan(100);
    expect(cells().length).toBeGreaterThanOrEqual(columns);
    // Rows carry their position in the whole grid.
    expect(within(g).getAllByRole('row')[0]).toHaveAttribute('aria-rowindex', '1');
  });

  it('scrolling far renders and loads the rows there', async () => {
    show('/movies/category/20');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    act(() => {
      g.scrollTop = 300_000;
      fireEvent.scroll(g);
    });
    const firstRow = await waitFor(() => {
      const row = within(g)
        .getAllByRole('row')
        .find((r) => Number(r.getAttribute('aria-rowindex')) > 100);
      expect(row).toBeDefined();
      return row as HTMLElement;
    });
    await waitFor(() => expect(within(firstRow).getAllByRole('link').length).toBeGreaterThan(0));
    expect(cells().length).toBeLessThan(100);
  });

  it('keyboard: one tab stop; arrows move focus between cells; End jumps to the last movie', async () => {
    show('/movies/category/20');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    const columns = Number(g.getAttribute('aria-colcount'));
    const tabbable = g.querySelectorAll('[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    (tabbable[0] as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-index', '1');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAttribute('data-index', String(1 + columns));
    await userEvent.keyboard('{End}');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-index', String(MEGA - 1)),
    );
    await waitFor(() => expect(document.activeElement).toHaveTextContent(`Film ${MEGA}`));
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-index', '0'));
  });

  it('UX-05: arrows at the grid edges are left to the D-pad; inside, they do not wrap', async () => {
    show('/movies/category/20');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    const columns = Number(g.getAttribute('aria-colcount'));
    const first = g.querySelector<HTMLElement>('[tabindex="0"]');
    first?.focus();
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })).toBe(true);
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{ArrowRight}'.repeat(columns - 1));
    expect(document.activeElement).toHaveAttribute('data-index', String(columns - 1));
    // The end of the row: → does not wrap to the next row.
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })).toBe(true);
    expect(document.activeElement).toHaveAttribute('data-index', String(columns - 1));
    await userEvent.keyboard('{End}');
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-index', String(MEGA - 1)),
    );
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' })).toBe(true);
  });

  it('Back from the details returns to the same category, sort and scroll position (review #6)', async () => {
    const { router } = show('/movies/category/20?sort=name');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    act(() => {
      g.scrollTop = 300_000;
      fireEvent.scroll(g);
    });
    const far = await waitFor(() => {
      const row = within(g)
        .getAllByRole('row')
        .find((r) => Number(r.getAttribute('aria-rowindex')) > 100);
      expect(row).toBeDefined();
      return row as HTMLElement;
    });
    const card = await waitFor(() => within(far).getAllByRole('link')[0] as HTMLElement);
    const farRow = Number(far.getAttribute('aria-rowindex'));
    await userEvent.click(card);
    expect(router.state.location.pathname).toMatch(/^\/movies\/\d+$/);
    const back = await screen.findByRole('link', { name: 'Back to movies' });
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe('/movies/category/20'));
    expect(router.state.location.search).toBe('?sort=name');
    const again = await grid('Movies in Mega');
    // Scrolled back near the same rows, not to the top.
    await waitFor(() => {
      const indexes = within(again)
        .getAllByRole('row')
        .map((r) => Number(r.getAttribute('aria-rowindex')));
      expect(Math.max(...indexes)).toBeGreaterThanOrEqual(farRow - 5);
      expect(indexes).not.toContain(1);
    });
  });

  it('a card links to the movie details', async () => {
    show('/movies/category/10');
    const g = await grid('Movies in Action');
    const link = await within(g).findByRole('link', { name: /Zulu Dawn/ });
    expect(link).toHaveAttribute('href', '/movies/a1');
    expect(link).toHaveTextContent('1979');
  });
});

describe('MoviesScreen — sort (VOD-01 AC2)', () => {
  it('Recently added is the default; A–Z and Rating re-sort without the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { router } = show('/movies/category/10');
    const g = await grid('Movies in Action');
    await within(g).findByText('Zulu Dawn');
    // Newest first; undated last in source order.
    expect(titles(g)).toEqual(['Écran Total', 'Movie 9', 'Zulu Dawn', 'alpha Strike', 'Movie 10']);

    const select = screen.getByRole('combobox', { name: 'Sort by' });
    await userEvent.selectOptions(select, 'name');
    expect(router.state.location.search).toBe('?sort=name');
    await waitFor(() =>
      expect(titles(screen.getByRole('grid'))).toEqual([
        'alpha Strike',
        'Écran Total',
        'Movie 9',
        'Movie 10',
        'Zulu Dawn',
      ]),
    );

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'rating');
    await waitFor(() =>
      expect(titles(screen.getByRole('grid'))).toEqual([
        'alpha Strike',
        'Movie 10',
        'Zulu Dawn',
        'Écran Total',
        'Movie 9',
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a sort deep link applies; the sort is kept when changing category', async () => {
    show('/movies/category/10?sort=name');
    const g = await grid('Movies in Action');
    await within(g).findByText('Zulu Dawn');
    expect(titles(g)[0]).toBe('alpha Strike');
    expect(screen.getByRole('link', { name: 'Mega' })).toHaveAttribute(
      'href',
      '/movies/category/20?sort=name',
    );
  });

  it('Rating is only offered when the category has ratings', async () => {
    show('/movies/category/20?sort=rating');
    const g = await grid('Movies in Mega');
    await within(g).findByRole('link', { name: 'Film 1' });
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect(within(select).queryByRole('option', { name: 'Rating' })).toBeNull();
    // Falls back to the default order.
    expect(select).toHaveValue('added');
  });
});

describe('MoviesScreen — posters (VOD-01 AC3/AC4)', () => {
  it('lazy, no-referrer posters; missing or unloadable ones become a tonal block with the title', async () => {
    show('/movies/category/10');
    const g = await grid('Movies in Action');
    const zulu = await within(g).findByRole('link', { name: /Zulu Dawn/ });
    const img = zulu.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://img.example.test/zulu.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('alt', '');

    // No poster, and a `javascript:` poster: fallbacks, never an <img>.
    for (const name of [/alpha Strike/, /Écran Total/]) {
      const card = within(g).getByRole('link', { name });
      expect(card.querySelector('img')).toBeNull();
      expect(within(card).getByTestId('poster-fallback')).toHaveTextContent(
        card.querySelector('.poster-title')?.textContent ?? '',
      );
    }

    // A poster that fails to load.
    fireEvent.error(img as HTMLImageElement);
    expect(zulu.querySelector('img')).toBeNull();
    expect(within(zulu).getByTestId('poster-fallback')).toHaveTextContent('Zulu Dawn');
  });

  it('movies with a saved position show a progress bar (Continue watching)', async () => {
    await historyRepo.upsert({
      itemKey: itemKey(SOURCE, 'movie', 'a2'),
      positionSec: 600,
      durationSec: 1500,
    });
    await historyRepo.upsert({
      itemKey: itemKey(SOURCE, 'movie', 'a1'),
      positionSec: 600,
      durationSec: 1500,
      completed: true,
    });
    // TEC-03: the grid shows any started item (30 s is not in Home's "Continue watching").
    await historyRepo.upsert({
      itemKey: itemKey(SOURCE, 'movie', 'a3'),
      positionSec: 30,
      durationSec: 1500,
    });
    try {
      show('/movies/category/10');
      const g = await grid('Movies in Action');
      const alpha = await within(g).findByRole('link', { name: /alpha Strike/ });
      expect(alpha).toHaveAccessibleName(expect.stringContaining('40% watched'));
      const bar = within(alpha).getByTestId('poster-progress');
      expect(bar.firstElementChild).toHaveStyle({ width: '40%' });
      // Completed: no bar.
      const zulu = within(g).getByRole('link', { name: /Zulu Dawn/ });
      expect(within(zulu).queryByTestId('poster-progress')).toBeNull();
      // Started (30 s): the grid shows its bar, although Home's row does not list it.
      const ecran = within(g).getByRole('link', { name: /Écran Total/ });
      expect(within(ecran).getByTestId('poster-progress').firstElementChild).toHaveStyle({
        width: '2%',
      });
    } finally {
      await historyRepo.remove(itemKey(SOURCE, 'movie', 'a2'));
      await historyRepo.remove(itemKey(SOURCE, 'movie', 'a1'));
      await historyRepo.remove(itemKey(SOURCE, 'movie', 'a3'));
    }
  });
});

describe('MoviesScreen — active list (SRC-08 AC4)', () => {
  it('switching the active list reloads its categories and leaves the old category', async () => {
    const { router } = show('/movies/category/10?sort=name');
    await grid('Movies in Action');
    await act(() => setActiveSource(OTHER));
    await waitFor(() => expect(router.state.location.pathname).toBe('/movies'));
    expect(router.state.location.search).toBe('?sort=name');
    const g = await grid('Movies in All');
    await within(g).findByRole('link', { name: 'Deep Sea' });
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['All', 'Docs', 'Uncategorized']);
  });
});
