// Routes of features/movies (FND-04). Registered by the feature and composed by
// src/app/router.tsx inside the AppShell layout (paths are relative to `/`).
// Every screen is lazy-loaded (its own chunk). Use the `lazy` *function* form: React Router
// mutates a `lazy` *object* in place, which breaks when several routers share these route
// objects (tests, React StrictMode).
import type { RouteObject } from 'react-router';

export const moviesRoutes: RouteObject[] = [
  {
    path: 'movies',
    lazy: async () => ({ Component: (await import('./MoviesScreen')).MoviesScreen }),
  },
  {
    path: 'movies/category/:categoryId',
    lazy: async () => ({ Component: (await import('./MoviesScreen')).MoviesScreen }),
  },
  {
    path: 'movies/:movieId',
    lazy: async () => ({ Component: (await import('./MovieDetailsScreen')).MovieDetailsScreen }),
  },
];
