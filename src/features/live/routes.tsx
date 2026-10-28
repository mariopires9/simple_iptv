// Routes of features/live (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import { redirect, type RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const liveRoutes: RouteObject[] = [
  { path: 'live', lazy: lazyScreen(() => import('./LiveScreen'), 'LiveScreen') },
  // A category path without an id is not an item id: back to the list.
  { path: 'live/category', loader: () => redirect('/live') },
  {
    path: 'live/category/:categoryId',
    lazy: lazyScreen(() => import('./LiveScreen'), 'LiveScreen'),
  },
];
