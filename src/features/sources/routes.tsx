// Routes of features/sources (FND-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const sourcesRoutes: RouteObject[] = [
  { path: 'settings/sources', lazy: lazyScreen(() => import('./SourcesScreen'), 'SourcesScreen') },
];
