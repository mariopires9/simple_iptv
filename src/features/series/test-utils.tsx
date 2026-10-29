// Test helpers of features/series (imported by tests only): a router around the Series screens,
// plus the shared jsdom grid metrics and synthetic sources (`@/ui/test-utils`).
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { SeriesDetailsScreen } from './SeriesDetailsScreen';
import { SeriesScreen } from './SeriesScreen';

export { installScrollMetrics } from '@/ui/test-utils/scrollMetrics';
export { m3uSource } from '@/ui/test-utils/sources';

const routes = [
  { path: '/series', Component: SeriesScreen },
  { path: '/series/category/:categoryId', Component: SeriesScreen },
  { path: '/series/:seriesId', Component: SeriesDetailsScreen },
  { path: '*', element: null },
];

/** Renders the Series routes at `path` with a viewport `width` (default: desktop). */
export function renderSeries(path = '/series', width = 1400) {
  const media = installMatchMedia({ width });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return { ...view, router, media };
}
