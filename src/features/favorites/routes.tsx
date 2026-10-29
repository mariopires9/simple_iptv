// Routes of features/favorites (FND-04, FAV-03), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`). Home lives here too: it shows the
// favorites and the history of the active list.
import type { RouteObject } from 'react-router';
import type { LazyNamespace } from '@/i18n';
import { lazyScreen } from '@/ui/lazyScreen';

/** Strings the Home and Favorites screens read, loaded with them (TEC-01). */
const FAVORITES_STRINGS: readonly LazyNamespace[] = ['favorites'];

/** Home (`/`, the index route). */
export const homeRoute: RouteObject = {
  index: true,
  lazy: lazyScreen(() => import('./HomeScreen'), 'HomeScreen', FAVORITES_STRINGS),
};

export const favoritesRoutes: RouteObject[] = [
  {
    path: 'favorites',
    lazy: lazyScreen(() => import('./FavoritesScreen'), 'FavoritesScreen', FAVORITES_STRINGS),
  },
];
