// Test helpers of features/movies (imported by tests only): synthetic catalogues in
// fake-indexeddb, jsdom scroll metrics for the virtualised grid and a router around the screens.
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { Source } from '@/core/db';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { MovieDetailsScreen } from './MovieDetailsScreen';
import { MoviesScreen } from './MoviesScreen';

/** Viewport of the mocked grid (px). */
export const GRID_WIDTH = 1000;
export const GRID_HEIGHT = 800;

export function m3uSource(id: string, name: string, createdAt: number, lastSyncAt = 1): Source {
  return {
    id,
    kind: 'm3u-url',
    name,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncAt,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

/**
 * jsdom has no layout: give the grid a fixed viewport and make `scrollTo` move `scrollTop` and
 * fire `scroll` as a browser would. Returns a restore function.
 */
export function installScrollMetrics(): () => void {
  const proto = HTMLElement.prototype;
  const originals = {
    clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
    scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
  };
  const tops = new WeakMap<Element, number>();
  const isGrid = (el: Element) => el.getAttribute('role') === 'grid';
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isGrid(this) ? GRID_HEIGHT : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return isGrid(this) ? GRID_WIDTH : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, value);
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: Element, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    },
  });
  return () => {
    for (const [name, descriptor] of Object.entries(originals)) {
      const target = name.startsWith('client') ? proto : Element.prototype;
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete (target as unknown as Record<string, unknown>)[name];
    }
  };
}

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
