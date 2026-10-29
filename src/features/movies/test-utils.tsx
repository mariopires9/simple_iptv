// Test helpers of features/movies (imported by tests only): synthetic catalogues in
// fake-indexeddb, jsdom scroll metrics for the virtualised grid (shared, `@/ui/test-utils`) and a
// router around the screens.
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { MovieDetailsScreen } from './MovieDetailsScreen';
import { MoviesScreen } from './MoviesScreen';

export { m3uSource } from '@/ui/test-utils/sources';
export { GRID_HEIGHT, GRID_WIDTH, installScrollMetrics } from '@/ui/test-utils/scrollMetrics';

const routes = [
  { path: '/movies', Component: MoviesScreen },
  { path: '/movies/category/:categoryId', Component: MoviesScreen },
  { path: '/movies/:movieId', Component: MovieDetailsScreen },
  { path: '*', element: null },
];

/** Renders the Movies routes at `path` with a viewport `width` (default: desktop). */
export function renderMovies(path = '/movies', width = 1400) {
  const media = installMatchMedia({ width });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return { ...view, router, media };
}
