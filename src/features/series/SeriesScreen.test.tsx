// SER-01: series grid (categories, posters with the number of seasons when known, sort,
// "Uncategorized", active-list switching), on the shared poster-grid screen.
import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogRepo,
  itemKey,
  settingsRepo,
  sourcesRepo,
  wipeAll,
  type CatalogItemInput,
} from '@/core/db';
import { forgetActiveSource, setActiveSource } from '@/core/session';
import { clearProjectionCache } from '@/ui/catalog/sortIndex';
import { seriesBrowse } from './browseState';
import { installScrollMetrics, m3uSource, renderSeries } from './test-utils';

const SOURCE = 'src1';
const OTHER = 'src2';

const DRAMA: CatalogItemInput<'series'>[] = [
  {
    externalId: 's1',
    categoryExternalId: '10',
    name: 'Zebra Nights',
    year: 2019,
    rating: 6.5,
    cover: 'https://img.example.test/zebra.jpg',
  },
  { externalId: 's2', categoryExternalId: '10', name: 'alpha House', rating: 8.9 },
  { externalId: 's3', categoryExternalId: '10', name: 'Éclair', year: 2021 },
  { externalId: 's4', categoryExternalId: '10', name: 'Bad Cover', cover: 'javascript:alert(1)' },
];

beforeAll(async () => {
  await sourcesRepo.put(m3uSource(SOURCE, 'Test list', 1));
  await sourcesRepo.put(m3uSource(OTHER, 'Other list', 2));
  await catalogRepo.replaceForSource(SOURCE, 'series', {
    categories: [
      { externalId: '10', name: 'Drama' },
      { externalId: '20', name: 'Empty' },
    ],
    items: DRAMA,
  });
  await catalogRepo.replaceForSource(OTHER, 'series', {
    categories: [
      { externalId: '1', name: 'Docs' },
      { externalId: 'uncategorized', name: '' },
    ],
    items: [
      { externalId: 'd1', categoryExternalId: '1', name: 'Deep Sea' },
      { externalId: 'o1', categoryExternalId: 'uncategorized', name: 'Orphan Show' },
    ],
  });
  // Details already fetched for one series: its card shows the number of seasons.
  await catalogRepo.setSeasonCount(itemKey(SOURCE, 'series', 's1'), 3);
  await settingsRepo.set('activeSourceId', SOURCE);
});

afterAll(async () => {
  await wipeAll();
});

let restoreScroll: () => void;
let media: { restore(): void } | undefined;
beforeEach(() => {
  restoreScroll = installScrollMetrics();
});
afterEach(async () => {
  restoreScroll();
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  forgetActiveSource();
  clearProjectionCache();
  seriesBrowse.clear();
  await settingsRepo.set('activeSourceId', SOURCE);
});

function show(path?: string, width?: number) {
  const view = renderSeries(path, width);
  media = view.media;
  return view;
}
const grid = (name: string | RegExp = /^Series in/) =>
  screen.findByRole('grid', { name }, { timeout: 5000 });
const titles = (g: HTMLElement) =>
  within(g)
    .getAllByRole('link')
    .map((l) => l.querySelector('.poster-title')?.textContent);

describe('SeriesScreen — grid (SER-01)', () => {
  it('categories, heading and the series of the category with links to their details', async () => {
    show('/series');
    const g = await grid('Series in All');
    await within(g).findByText('Zebra Nights');
    expect(screen.getByRole('heading', { level: 1, name: 'Series' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['All', 'Drama', 'Empty']);
    expect(within(g).getByRole('link', { name: /Zebra Nights/ })).toHaveAttribute(
      'href',
      '/series/s1',
    );
    // One tab stop in the grid; a keyboard hint describes it.
    expect(g.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(g).toHaveAccessibleDescription(
      'Arrow keys move between series, Enter opens the selected one.',
    );
  });

  it('a card shows the number of seasons when known, else the year', async () => {
    show('/series/category/10');
    const g = await grid('Series in Drama');
    const zebra = await within(g).findByRole('link', { name: /Zebra Nights/ });
    expect(zebra).toHaveTextContent('3 seasons');
    expect(zebra).not.toHaveTextContent('2019');
    expect(within(g).getByRole('link', { name: /Éclair/ })).toHaveTextContent('2021');
  });

  it('missing or unusable covers become a tonal placeholder with the title', async () => {
    show('/series/category/10');
    const g = await grid('Series in Drama');
    const bad = await within(g).findByRole('link', { name: /Bad Cover/ });
    expect(within(bad).getByTestId('poster-fallback')).toHaveTextContent('Bad Cover');
    expect(bad.querySelector('img')).toBeNull();
    const zebra = within(g).getByRole('link', { name: /Zebra Nights/ });
    expect(zebra.querySelector('img')).toHaveAttribute('src', 'https://img.example.test/zebra.jpg');
  });

  it('sorts A–Z and by rating without the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { router } = show('/series/category/10');
    const g = await grid('Series in Drama');
    await within(g).findByText('Zebra Nights');
    // No dates on series: "Recently added" keeps the source order.
    expect(titles(g)).toEqual(['Zebra Nights', 'alpha House', 'Éclair', 'Bad Cover']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    expect(router.state.location.search).toBe('?sort=name');
    await waitFor(() =>
      expect(titles(screen.getByRole('grid'))).toEqual([
        'alpha House',
        'Bad Cover',
        'Éclair',
        'Zebra Nights',
      ]),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'rating');
    await waitFor(() =>
      expect(titles(screen.getByRole('grid'))).toEqual([
        'alpha House',
        'Zebra Nights',
        'Éclair',
        'Bad Cover',
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an empty category says so', async () => {
    show('/series/category/20');
    expect(
      await screen.findByRole('heading', { name: 'This category is empty.' }),
    ).toBeInTheDocument();
  });

  it('an unknown category offers "Show all series", keeping the sort', async () => {
    show('/series/category/nope?sort=name');
    expect(await screen.findByRole('link', { name: 'Show all series' })).toHaveAttribute(
      'href',
      '/series?sort=name',
    );
  });

  it('series without a category are in "All" and in a localised "Uncategorized"', async () => {
    await settingsRepo.set('activeSourceId', OTHER);
    show('/series');
    await grid('Series in All');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Uncategorized' }));
    const own = await grid('Series in Uncategorized');
    await within(own).findByRole('link', { name: /Orphan Show/ });
    expect(titles(own)).toEqual(['Orphan Show']);
  });

  it('switching the active list reloads its categories and leaves the old category', async () => {
    const { router } = show('/series/category/10');
    await grid('Series in Drama');
    await act(() => setActiveSource(OTHER));
    await waitFor(() => expect(router.state.location.pathname).toBe('/series'));
    const g = await grid('Series in All');
    await within(g).findByRole('link', { name: /Deep Sea/ });
  });

  it('mobile: chips and a 3-column grid', async () => {
    show('/series/category/10', 400);
    const g = await grid('Series in Drama');
    expect(g).toHaveAttribute('aria-colcount', '3');
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(nav.querySelectorAll('.MuiChip-root')).toHaveLength(3);
  });
});

describe('SeriesScreen — no source', () => {
  it('shows the empty state', async () => {
    await settingsRepo.set('activeSourceId', 'missing');
    vi.spyOn(sourcesRepo, 'list').mockResolvedValue([]);
    show('/series');
    expect(
      await screen.findByRole('heading', { name: "You don't have any IPTV lists yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText('Add a list to see its series here.')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });
});
