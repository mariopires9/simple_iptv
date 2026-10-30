// Routes of features/live (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import type { LazyNamespace } from '@/i18n';
import { lazyScreen } from '@/ui/lazyScreen';

/** Strings the Live screens read, loaded with them (TEC-01); `player` loads with `@/player/ui`. */
const LIVE_STRINGS: readonly LazyNamespace[] = ['live', 'parental'];

export const liveRoutes: RouteObject[] = [
  { path: 'live', lazy: lazyScreen(() => import('./LiveScreen'), 'LiveScreen', LIVE_STRINGS) },
  // A category path without an id is not an item id: back to the list.
  { path: 'live/category', loader: () => redirect('/live') },
  {
    path: 'live/category/:categoryId',
    lazy: lazyScreen(() => import('./LiveScreen'), 'LiveScreen', LIVE_STRINGS),
  },
];
