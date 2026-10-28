// Routes of features/movies (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const moviesRoutes: RouteObject[] = [
  { path: 'movies', lazy: lazyScreen(() => import('./MoviesScreen'), 'MoviesScreen') },
  // A category path without an id is not an item id: back to the list.
  { path: 'movies/category', loader: () => redirect('/movies') },
  {
    path: 'movies/category/:categoryId',
    lazy: lazyScreen(() => import('./MoviesScreen'), 'MoviesScreen'),
  },
  {
    path: 'movies/:movieId',
    lazy: lazyScreen(() => import('./MovieDetailsScreen'), 'MovieDetailsScreen'),
  },
];
