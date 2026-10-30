// Routes of features/series (FND-04, SER-01/02), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import type { LazyNamespace } from '@/i18n';
import { lazyScreen } from '@/ui/lazyScreen';

/** Strings the Series screens read, loaded with them (TEC-01); `player` loads with `@/player/ui`. */
const SERIES_STRINGS: readonly LazyNamespace[] = ['series', 'parental'];

export const seriesRoutes: RouteObject[] = [
  {
    path: 'series',
    lazy: lazyScreen(() => import('./SeriesScreen'), 'SeriesScreen', SERIES_STRINGS),
  },
  // A category path without an id is not an item id: back to the list.
  { path: 'series/category', loader: () => redirect('/series') },
  {
    path: 'series/category/:categoryId',
    lazy: lazyScreen(() => import('./SeriesScreen'), 'SeriesScreen', SERIES_STRINGS),
  },
  {
    path: 'series/:seriesId',
    lazy: lazyScreen(() => import('./SeriesDetailsScreen'), 'SeriesDetailsScreen', SERIES_STRINGS),
  },
];
