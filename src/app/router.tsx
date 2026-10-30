// Hash router (ADR-007, FND-04): deep links such as `/#/movies/category/123` work on GitHub Pages
// without a server fallback. Features register their own routes (`features/<x>/routes.tsx`,
// docs/AGENT_WORKFLOW.md §5); this file only composes them and adds the per-route error boundary.
import { createHashRouter, matchRoutes, parsePath, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { log } from '@/core/log';
import { favoritesRoutes, homeRoute } from '@/features/favorites';
import { liveRoutes } from '@/features/live';
import { moviesRoutes } from '@/features/movies';
import { onboardingRoutes } from '@/features/onboarding';
import { searchRoutes } from '@/features/search';
import { seriesRoutes } from '@/features/series';
import { settingsRoutes } from '@/features/settings';
import { sourcesOnboardingRoutes, sourcesRoutes } from '@/features/sources';
import { FullScreenLayout, RouteFallback, ShellLayout } from './routes/layouts';
import { NotFoundScreen } from './routes/NotFoundScreen';
import { isOnboardingExempt, ONBOARDING_PATH } from './routes/onboardingGuard';
import { RootErrorBoundary, RouteErrorBoundary } from './routes/RouteErrorBoundary';

type Router = ReturnType<typeof createHashRouter>;

/** Every screen gets its own error boundary and an empty first-load fallback. */
function screen(route: RouteObject): RouteObject {
  return { ...route, ErrorBoundary: RouteErrorBoundary, HydrateFallback: RouteFallback };
}

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
    children: [...onboardingRoutes, ...sourcesOnboardingRoutes].map(screen),
  },
];

let appRouter: Router | undefined;

/**
 * The app's single hash router, created on first use outside React state: StrictMode's double
 * render (or a remount) must not create a second router listening to `popstate`.
 */
export function getAppRouter(): Router {
  appRouter ??= createHashRouter(appRoutes);
  return appRouter;
}

/** Whether `pathname` renders inside the AppShell (the routes the onboarding guard covers). */
function isShellPath(pathname: string): boolean {
  return matchRoutes(appRoutes, pathname)?.[0]?.route === appRoutes[0];
}

/** Whether the onboarding guard covers the start location (read from the hash like the router). */
function startIsGuarded(): boolean {
  const pathname = parsePath(window.location.hash.slice(1) || '/').pathname || '/';
  return isShellPath(pathname) && !isOnboardingExempt(pathname);
}

/**
 * QA-04: start-up only, before the router exists. With no sources, a guarded start location is
 * replaced by the onboarding route, as the onboarding guard's redirect would do after the first
 * render. The router then loads only the onboarding screen: not the AppShell's start screen, its
 * strings and the list selector, which the guard would hide at once (one less request round on
 * the first-run critical path, and no empty shell shown before the redirect). Once the router
 * exists it owns the location: nothing is changed.
 */
export function applyStartupRedirect(sourcesPresent: boolean): void {
  if (appRouter || sourcesPresent || !startIsGuarded()) return;
  window.history.replaceState(window.history.state, '', `#${ONBOARDING_PATH}`);
}

/** Tests only: dispose the router so the next `getAppRouter()` reads `window.location` again. */
export function resetAppRouter(): void {
  appRouter?.dispose();
  appRouter = undefined;
}

/** Called once per error (loader, lazy import or render): the boundary itself never logs. */
function logRouteError(error: unknown, info: { pattern: string }): void {
  log.error('Route error', { pattern: info.pattern, error });
}

export function AppRouter({ router }: { router: Router }) {
  return <RouterProvider router={router} onError={logRouteError} />;
}
