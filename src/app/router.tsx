// Hash router (ADR-007, FND-04): deep links such as `/#/movies/category/123` work on GitHub Pages
// without a server fallback. Features register their own routes (`features/<x>/routes.tsx`,
// docs/AGENT_WORKFLOW.md §5); this file only composes them and adds the per-route error boundary.
import { createHashRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { log } from '@/core/log';
import { favoritesRoutes } from '@/features/favorites';
import { liveRoutes } from '@/features/live';
import { moviesRoutes } from '@/features/movies';
import { onboardingRoutes } from '@/features/onboarding';
import { searchRoutes } from '@/features/search';
import { seriesRoutes } from '@/features/series';
import { settingsRoutes } from '@/features/settings';
import { sourcesRoutes } from '@/features/sources';
import { FullScreenLayout, RouteFallback, ShellLayout } from './routes/layouts';
import { NotFoundScreen } from './routes/NotFoundScreen';
import { RootErrorBoundary, RouteErrorBoundary } from './routes/RouteErrorBoundary';

type Router = ReturnType<typeof createHashRouter>;

/** Every screen gets its own error boundary and an empty first-load fallback. */
function screen(route: RouteObject): RouteObject {
  return { ...route, ErrorBoundary: RouteErrorBoundary, HydrateFallback: RouteFallback };
}

// `lazy` as a function, never as an object: React Router mutates a lazy *object* in place, so
// route objects shared by several routers (tests, StrictMode) would lose their screens.
const homeRoute: RouteObject = {
  index: true,
  lazy: async () => ({ Component: (await import('./routes/HomeScreen')).HomeScreen }),
};

/** The whole route tree; exported for tests (memory router). */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: ShellLayout,
    ErrorBoundary: RootErrorBoundary,
    HydrateFallback: RouteFallback,
    children: [
      homeRoute,
      ...liveRoutes,
      ...moviesRoutes,
      ...seriesRoutes,
      ...favoritesRoutes,
      ...searchRoutes,
      ...settingsRoutes,
      ...sourcesRoutes,
      { path: '*', Component: NotFoundScreen },
    ].map(screen),
  },
  {
    Component: FullScreenLayout,
    ErrorBoundary: RootErrorBoundary,
    HydrateFallback: RouteFallback,
    children: onboardingRoutes.map(screen),
  },
];

export function createAppRouter(): Router {
  return createHashRouter(appRoutes);
}

/** Called once per error (loader, lazy import or render): the boundary itself never logs. */
function logRouteError(error: unknown, info: { pattern: string }): void {
  log.error('Route error', { pattern: info.pattern, error });
}

export function AppRouter({ router }: { router: Router }) {
  return <RouterProvider router={router} onError={logRouteError} />;
}
