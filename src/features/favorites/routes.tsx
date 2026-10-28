// Routes of features/favorites (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const favoritesRoutes: RouteObject[] = [
  { path: 'favorites', lazy: lazyScreen(() => import('./FavoritesScreen'), 'FavoritesScreen') },
];
