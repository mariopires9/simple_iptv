// Routes of features/series (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const seriesRoutes: RouteObject[] = [
  { path: 'series', lazy: lazyScreen(() => import('./SeriesScreen'), 'SeriesScreen', []) },
  // A category path without an id is not an item id: back to the list.
  { path: 'series/category', loader: () => redirect('/series') },
  {
    path: 'series/category/:categoryId',
    lazy: lazyScreen(() => import('./SeriesScreen'), 'SeriesScreen', []),
  },
  {
    path: 'series/:seriesId',
    lazy: lazyScreen(() => import('./SeriesDetailsScreen'), 'SeriesDetailsScreen', []),
  },
];
