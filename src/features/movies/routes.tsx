// Routes of features/movies (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import type { LazyNamespace } from '@/i18n';
import { lazyScreen } from '@/ui/lazyScreen';

/** Strings the Movies screens read, loaded with them (TEC-01); `player` loads with `@/player/ui`. */
const MOVIES_STRINGS: readonly LazyNamespace[] = ['movies'];

export const moviesRoutes: RouteObject[] = [
  {
    path: 'movies',
    lazy: lazyScreen(() => import('./MoviesScreen'), 'MoviesScreen', MOVIES_STRINGS),
  },
  // A category path without an id is not an item id: back to the list.
  { path: 'movies/category', loader: () => redirect('/movies') },
  {
    path: 'movies/category/:categoryId',
    lazy: lazyScreen(() => import('./MoviesScreen'), 'MoviesScreen', MOVIES_STRINGS),
  },
  {
    path: 'movies/:movieId',
    lazy: lazyScreen(() => import('./MovieDetailsScreen'), 'MovieDetailsScreen', MOVIES_STRINGS),
  },
];
