// Test helpers of features/favorites (imported by tests only): a small synthetic catalogue in
// fake-indexeddb and a memory router around the Home and Favorites screens.
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { catalogRepo, sourcesRepo, type CatalogItemInput, type Source } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { FavoritesScreen } from './FavoritesScreen';
import { HomeScreen } from './HomeScreen';

export const SOURCE = 'src1';
export const OTHER = 'src2';

export function m3uSource(id: string, name: string, createdAt: number): Source {
  return {
    id,
    kind: 'm3u-url',
    name,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

/**
 * Two lists. `src1`: channels `c1`…`c40` in category `10` ("News") plus `nc` without a category,
 * movies `m1`…`m30`, series `s1`…`s3`. `src2`: channel `o1`, movie `om1`.
 */
export async function seedCatalog(): Promise<void> {
  await sourcesRepo.put(m3uSource(SOURCE, 'Main list', 1));
  await sourcesRepo.put(m3uSource(OTHER, 'Other list', 2));
  const channels: CatalogItemInput<'live'>[] = Array.from({ length: 40 }, (_, i) => ({
    externalId: `c${i + 1}`,
    categoryExternalId: '10',
    name: `Channel ${i + 1}`,
    streamPath: '',
    streamUrl: `https://cdn.example.test/c${i + 1}.m3u8`,
  }));
  channels.push({ externalId: 'nc', name: 'Loose channel', streamPath: '' });
  await catalogRepo.replaceForSource(SOURCE, 'live', {
    categories: [{ externalId: '10', name: 'News' }],
    items: channels,
  });
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [],
    items: Array.from({ length: 30 }, (_, i) => ({
      externalId: `m${i + 1}`,
      name: `Movie ${i + 1}`,
      streamPath: '',
    })),
  });
  await catalogRepo.replaceForSource(SOURCE, 'series', {
    categories: [],
    items: Array.from({ length: 3 }, (_, i) => ({
      externalId: `s${i + 1}`,
      name: `Show ${i + 1}`,
    })),
  });
  await catalogRepo.replaceForSource(OTHER, 'live', {
    categories: [],
    items: [{ externalId: 'o1', name: 'Other channel', streamPath: '' }],
  });
  await catalogRepo.replaceForSource(OTHER, 'movie', {
    categories: [],
    items: [{ externalId: 'om1', name: 'Other movie', streamPath: '' }],
  });
}

const routes = [
  { path: '/', Component: HomeScreen },
  { path: '/favorites', Component: FavoritesScreen },
  { path: '*', element: null },
];

/** Renders the Home and Favorites routes at `path`. */
export function renderScreens(path = '/') {
  const media = installMatchMedia({ width: 1400 });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return { ...view, router, media };
}
