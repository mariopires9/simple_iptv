// Routes of features/sources (FND-04), composed by src/app/router.tsx.
// Statically reachable from the router: screens are lazy, nothing here may import `@/core/db`.
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

/** Inside the AppShell layout (paths relative to `/`). */
export const sourcesRoutes: RouteObject[] = [
  {
    path: 'settings/sources',
    lazy: lazyScreen(() => import('./SourcesScreen'), 'SourcesScreen', ['sources']),
  },
  {
    path: 'settings/sources/add/xtream',
    lazy: lazyScreen(() => import('./AddXtreamScreen'), 'AddXtreamScreen', ['sources']),
  },
  {
    path: 'settings/sources/add/m3u-url',
    lazy: lazyScreen(() => import('./AddM3uUrlScreen'), 'AddM3uUrlScreen', ['sources']),
  },
  {
    path: 'settings/sources/:sourceId/edit',
    lazy: lazyScreen(() => import('./EditSourceScreen'), 'EditSourceScreen', ['sources']),
  },
];

/** Full screen, in the onboarding flow (UX-01): one route per source type. */
export const sourcesOnboardingRoutes: RouteObject[] = [
  {
    path: '/onboarding/xtream',
    lazy: lazyScreen(() => import('./AddXtreamScreen'), 'OnboardingXtreamScreen', ['sources']),
  },
  {
    path: '/onboarding/m3u-url',
    lazy: lazyScreen(() => import('./AddM3uUrlScreen'), 'OnboardingM3uUrlScreen', ['sources']),
  },
  {
    path: '/onboarding/m3u-file',
    lazy: lazyScreen(() => import('./ComingSoonScreen'), 'M3uFileComingSoonScreen', ['sources']),
  },
];
