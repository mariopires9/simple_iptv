// Routes of features/search (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const searchRoutes: RouteObject[] = [
  { path: 'search', lazy: lazyScreen(() => import('./SearchScreen'), 'SearchScreen') },
];
