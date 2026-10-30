// SCH-02: global search screen and the `/` shortcut. The worker call is replaced by the real
// worker-side search (src/worker/search) running in-process over fake-indexeddb.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router';
import { catalogRepo, itemKey, settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import { t } from '@/i18n';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import {
  resetSearchCacheForTests,
  searchCatalog,
  warmUpSearch,
  type SearchQueryInput,
} from '@/worker/search/searchService';
import { SearchAction } from './SearchAction';
import { SearchScreen } from './SearchScreen';

const runTask = vi.hoisted(() => vi.fn());
vi.mock('@/worker', () => ({ runTask }));

const SRC = 'src1';
const OTHER = 'src2';
const MOVIES = 25;

function source(id: string, createdAt: number): Source {
  return {
    id,
    kind: 'm3u-url',
    name: id,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

async function seed(): Promise<void> {
  await sourcesRepo.put(source(SRC, 1));
  await sourcesRepo.put(source(OTHER, 2));
  await catalogRepo.replaceAllForExistingSource(SRC, {
    live: {
      categories: [{ externalId: 'news', name: 'News' }],
      items: [
        {
          externalId: '1',
          categoryExternalId: 'news',
          name: 'Example News',
          number: 101,
          streamPath: '',
        },
        { externalId: '2', name: 'Example Loose Channel', streamPath: '' },
      ],
    },
    movie: {
      categories: [{ externalId: 'act', name: 'Action' }],
      items: Array.from({ length: MOVIES }, (_, i) => ({
        externalId: String(10 + i),
        categoryExternalId: 'act',
        name: `Example Movie ${i + 1}`,
        year: 2000 + i,
        streamPath: '',
      })),
    },
    series: { categories: [], items: [{ externalId: '20', name: 'Example Drama' }] },
  });
  await catalogRepo.replaceForSource(OTHER, 'movie', {
    categories: [],
    items: [{ externalId: '1', name: 'Other Example', streamPath: '' }],
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function Shell() {
  return (
    <>
      <SearchAction />
      <input aria-label="Elsewhere" />
      <Outlet />
      <LocationProbe />
    </>
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/', element: <h1>Home</h1> },
          { path: '/search', element: <SearchScreen /> },
          { path: '/live/category/:categoryId', element: <h1>Live</h1> },
          { path: '/movies/:movieId', element: <h1>Movie</h1> },
          { path: '/series/:seriesId', element: <h1>Series</h1> },
          { path: '/settings/sources', element: <h1>Lists</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return router;
}

const location = () => screen.getByTestId('location').textContent;
const field = () => screen.getByRole('searchbox', { name: t.search.fieldLabel });
const searchCalls = () => runTask.mock.calls.filter(([name]) => name === 'searchQuery');

let media: ReturnType<typeof installMatchMedia> | undefined;

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  await wipeAll();
});

beforeEach(async () => {
  media = installMatchMedia({ width: 1400 });
  resetSearchCacheForTests();
  runTask.mockReset();
  runTask.mockImplementation((name: string, input: SearchQueryInput) =>
    name === 'searchQuery' ? searchCatalog(input) : warmUpSearch(input.sourceId),
  );
  await settingsRepo.set('activeSourceId', SRC);
  await settingsRepo.remove('recentSearches');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Unmount first: a mounted screen would re-read the active list as soon as it is forgotten,
  // and publish the previous test's list into the next test.
  cleanup();
  media?.restore();
  forgetActiveSource();
});

async function typeQuery(text: string) {
  const user = userEvent.setup();
  await user.clear(field());
  await user.type(field(), text);
}

describe('opening search (AC1)', () => {
  it('`/` opens the search screen with the focus in the field', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Home' });
    await userEvent.keyboard('/');
    await waitFor(() => expect(location()).toBe('/search'));
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveValue('');
  });

  it('`/` is typed normally in a text field and ignored with modifiers', async () => {
    renderAt('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('textbox', { name: 'Elsewhere' }));
    await user.keyboard('/');
    expect(screen.getByRole('textbox', { name: 'Elsewhere' })).toHaveValue('/');
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(location()).toBe('/');
  });

  it('the top-bar search icon opens search; on the search screen it focuses the field', async () => {
    renderAt('/');
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: t.nav.search }));
    await waitFor(() => expect(field()).toHaveFocus());
    await user.click(screen.getByRole('link', { name: t.nav.search }));
    expect(field()).toHaveFocus();
    expect(screen.getByRole('link', { name: t.nav.search })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // `/` on the search screen (focus elsewhere) brings the focus back to the field.
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('/');
    expect(field()).toHaveFocus();
  });
});

describe('results (AC2, AC5)', () => {
  it('groups results by type with headings, 20 per group and "see all"', async () => {
    renderAt('/search');
    await typeQuery('exam');
    const live = await screen.findByRole('region', { name: t.search.groupHeading('Live TV', 2) });
    expect(within(live).getAllByRole('link')).toHaveLength(2);
    expect(within(live).getByText('Example News')).toBeInTheDocument();
    expect(within(live).getByText(`${t.search.channelNumber(101)} · News`)).toBeInTheDocument();

    const movies = screen.getByRole('region', { name: t.search.groupHeading('Movies', MOVIES) });
    const movieLinks = within(movies).getAllByRole('link');
    // 20 results + the "see all" link.
    expect(movieLinks).toHaveLength(21);
    const seeAll = within(movies).getByRole('link', { name: t.search.seeAll('Movies', MOVIES) });
    expect(
      screen.getByRole('region', { name: t.search.groupHeading('Series', 1) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('search', { name: t.search.title })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t.search.announce(2 + MOVIES + 1));

    await userEvent.click(seeAll);
    await waitFor(() => expect(location()).toBe('/search?q=exam&type=movie'));
    const all = await screen.findByRole('region', {
      name: t.search.groupHeading('Movies', MOVIES),
    });
    await waitFor(() => expect(within(all).getAllByRole('link')).toHaveLength(MOVIES));
    expect(screen.queryByRole('region', { name: /Live TV/ })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: t.search.allResults }));
    await waitFor(() => expect(location()).toBe('/search?q=exam'));
  });

  it('waits 120 ms after the last keystroke before searching (debounce)', async () => {
    renderAt('/search');
    await waitFor(() => expect(field()).toHaveFocus());
    // The active list is known (the screen warms the index up as soon as it is): otherwise, on a
    // slow run, the debounce could fire before there is a list to search.
    await waitFor(() => expect(runTask).toHaveBeenCalledWith('searchWarmup', { sourceId: SRC }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(field(), { target: { value: 'e' } });
    fireEvent.change(field(), { target: { value: 'ex' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(field(), { target: { value: 'exa' } });
    act(() => vi.advanceTimersByTime(119));
    expect(searchCalls()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0]?.[1]).toMatchObject({ sourceId: SRC, query: 'exa', limit: 20 });
    vi.useRealTimers();
    expect(await screen.findByRole('region', { name: /^Series/ })).toBeInTheDocument();
  });

  it('does not search below 2 characters', async () => {
    renderAt('/search');
    await typeQuery('e');
    await new Promise((r) => setTimeout(r, 200));
    expect(searchCalls()).toHaveLength(0);
    expect(screen.getByText(t.search.hint)).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderAt('/search');
    await typeQuery('zzzz');
    expect(
      await screen.findByRole('heading', { name: t.search.noResults.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(t.search.noResults.message('zzzz'))).toBeInTheDocument();
  });

  it('switching the active list re-runs the query on the new list', async () => {
    renderAt('/search?q=example');
    expect(await screen.findByText('Example Drama')).toBeInTheDocument();
    await act(() => setActiveSource(OTHER));
    expect(await screen.findByText('Other Example')).toBeInTheDocument();
    expect(screen.queryByText('Example Drama')).toBeNull();
    expect(searchCalls().at(-1)?.[1]).toMatchObject({ sourceId: OTHER, query: 'example' });
  });

  it('shows an error with a retry when the search fails', async () => {
    runTask.mockImplementation((name: string) =>
      name === 'searchQuery' ? Promise.reject(new Error('worker down')) : Promise.resolve(),
    );
    renderAt('/search?q=example');
    expect(await screen.findByRole('heading', { name: t.search.error.title })).toBeInTheDocument();
    runTask.mockImplementation((name: string, input: SearchQueryInput) =>
      name === 'searchQuery' ? searchCatalog(input) : warmUpSearch(input.sourceId),
    );
    await userEvent.click(screen.getByRole('button', { name: t.state.actions.retry }));
    expect(await screen.findByText('Example Drama')).toBeInTheDocument();
  });

  it('arrow keys move between the field and the results', async () => {
    renderAt('/search?q=drama');
    const result = await screen.findByRole('link', { name: 'Example Drama' });
    const user = userEvent.setup();
    await user.click(field());
    await user.keyboard('{ArrowDown}');
    expect(result).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveFocus();
  });
});

describe('views and navigation (review)', () => {
  const realSearch = (name: string, input: SearchQueryInput) =>
    name === 'searchQuery' ? searchCatalog(input) : warmUpSearch(input.sourceId);
  /** Searches matching `hang` never answer (a slow worker). */
  const hangWhen = (hang: (input: SearchQueryInput) => boolean) =>
    runTask.mockImplementation((name: string, input: SearchQueryInput) =>
      name === 'searchQuery' && hang(input)
        ? new Promise(() => undefined)
        : realSearch(name, input),
    );

  it('"see all" uses the current query while older results are still on screen', async () => {
    const router = renderAt('/search?q=exam');
    await screen.findByRole('region', { name: /^Movies/ });
    hangWhen((input) => input.query === 'drama');
    fireEvent.change(field(), { target: { value: 'drama' } });
    await waitFor(() => expect(location()).toBe('/search?q=drama'));
    // The "exam" results are still shown (same list, same view) while "drama" runs.
    const movies = screen.getByRole('region', { name: /^Movies/ });
    await userEvent.click(within(movies).getByRole('link', { name: /^See all/ }));
    await waitFor(() => expect(location()).toBe('/search?q=drama&type=movie'));
    expect(router.state.location.search).toBe('?q=drama&type=movie');
  });

  it('a "see all" view never shows the grouped results while it loads', async () => {
    renderAt('/search?q=exam');
    const movies = await screen.findByRole('region', { name: /^Movies/ });
    hangWhen((input) => input.types !== undefined);
    await userEvent.click(within(movies).getByRole('link', { name: /^See all/ }));
    await waitFor(() => expect(location()).toBe('/search?q=exam&type=movie'));
    expect(screen.queryByRole('region', { name: /^Live TV|^Movies|^Series/ })).toBeNull();
    expect(screen.queryAllByRole('link', { name: /^Example/ })).toEqual([]);
  });

  it('the field follows the URL when navigating to another query', async () => {
    const router = renderAt('/search?q=exam');
    await screen.findByRole('region', { name: /^Movies/ });
    await act(() => router.navigate('/search?q=drama'));
    expect(field()).toHaveValue('drama');
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Movies/ })).toBeNull());
    expect(screen.getByRole('link', { name: 'Example Drama' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(field()).toHaveValue('exam');
  });
});

describe('opening a result (AC3)', () => {
  it.each([
    [
      'Example News',
      `/live/category/news?channel=${encodeURIComponent(itemKey(SRC, 'live', '1'))}`,
    ],
    [
      'Example Loose Channel',
      `/live/category/~all?channel=${encodeURIComponent(itemKey(SRC, 'live', '2'))}`,
    ],
    ['Example Movie 1', '/movies/10'],
    ['Example Drama', '/series/20'],
  ])('%s → %s', async (name, path) => {
    renderAt('/search?q=example');
    const link = await screen.findByRole('link', { name: new RegExp(`^${name}(?![0-9])`) });
    await userEvent.click(link);
    await waitFor(() => expect(location()).toBe(path));
  });
});

describe('recent searches (AC4)', () => {
  it('a search saved before the stored list was read is merged with it, not overwritten', async () => {
    await settingsRepo.set('recentSearches', ['drama']);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const original = settingsRepo.get.bind(settingsRepo);
    let first = true;
    vi.spyOn(settingsRepo, 'get').mockImplementation(async (key) => {
      if (key === 'recentSearches' && first) {
        first = false;
        await gate;
      }
      return original(key);
    });
    renderAt('/search');
    await typeQuery('news{Enter}');
    release();
    await waitFor(async () => expect(await original('recentSearches')).toEqual(['news', 'drama']));
    await userEvent.clear(field());
    const list = await screen.findByRole('region', { name: t.search.recent.title });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('button', { name: /drama|news/ })
          .map((b) => b.textContent),
      ).toEqual(['news', 'drama']),
    );
  });

  it('stores searches on Enter and when a result is opened; most recent first', async () => {
    renderAt('/search');
    await typeQuery('drama{Enter}');
    await waitFor(async () => expect(await settingsRepo.get('recentSearches')).toEqual(['drama']));
    await typeQuery('news');
    await userEvent.click(await screen.findByRole('link', { name: /^Example News/ }));
    await waitFor(async () =>
      expect(await settingsRepo.get('recentSearches')).toEqual(['news', 'drama']),
    );
  });

  it('lists them when the field is empty, runs one on click and clears them', async () => {
    await settingsRepo.set('recentSearches', ['drama', 'news', 42, '']);
    renderAt('/search');
    const recent = await screen.findByRole('region', { name: t.search.recent.title });
    const items = await within(recent).findAllByRole('button', { name: /drama|news/ });
    expect(items.map((b) => b.textContent)).toEqual(['drama', 'news']);
    await userEvent.click(items[1] as HTMLElement);
    expect(field()).toHaveValue('news');
    expect(await screen.findByText('Example News')).toBeInTheDocument();

    // Back to an empty field: "news" is now the most recent search.
    await userEvent.clear(field());
    const list = await screen.findByRole('region', { name: t.search.recent.title });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('button', { name: /drama|news/ })
          .map((b) => b.textContent),
      ).toEqual(['news', 'drama']),
    );
    await userEvent.click(within(list).getByRole('button', { name: t.search.recent.clearLabel }));
    expect(await screen.findByText(t.search.recent.empty)).toBeInTheDocument();
    await waitFor(async () => expect(await settingsRepo.get('recentSearches')).toBeUndefined());
  });
});

describe('protected content (UX-07)', () => {
  const protectedResult = (input: SearchQueryInput) => ({
    sourceId: input.sourceId,
    query: input.query,
    groups: {
      live: { total: 0, hits: [] },
      movie: {
        total: 1,
        hits: [
          {
            key: 'src1:movie:x',
            type: 'movie',
            externalId: 'x',
            name: 'Locked Film',
            protected: true,
          },
        ],
      },
      series: { total: 0, hits: [] },
    },
  });

  it('a protected result shows the badge and says so to screen readers', async () => {
    runTask.mockImplementation((name: string, input: SearchQueryInput) =>
      name === 'searchQuery' ? Promise.resolve(protectedResult(input)) : Promise.resolve(),
    );
    renderAt('/search?q=locked');
    const link = await screen.findByRole('link', {
      name: (n) => n.startsWith('Locked Film') && n.includes(t.state.protectedContent.label),
    });
    expect(within(link).getByTestId('protected-badge')).toBeInTheDocument();
    expect(searchCalls().at(-1)?.[1]).toMatchObject({ query: 'locked' });
    expect(searchCalls().at(-1)?.[1]).not.toHaveProperty('hideProtected');
  });

  it('"Hide protected content" is passed to the worker query', async () => {
    await settingsRepo.set('hideProtectedContent', true);
    try {
      renderAt('/search?q=example');
      expect(await screen.findByText('Example Drama')).toBeInTheDocument();
      expect(searchCalls().at(-1)?.[1]).toMatchObject({ query: 'example', hideProtected: true });
    } finally {
      await settingsRepo.remove('hideProtectedContent');
    }
  });
});

describe('no list', () => {
  it('asks to add a list', async () => {
    await settingsRepo.remove('activeSourceId');
    const all = await sourcesRepo.list();
    for (const s of all) await sourcesRepo.remove(s.id);
    renderAt('/search');
    expect(await screen.findByRole('heading', { name: t.search.noList.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.search.noList.action })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    await seed();
  });
});
