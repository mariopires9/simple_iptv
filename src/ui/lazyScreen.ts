// Lazy route screens (FND-04). Lives in `ui` (not `app`) because features register their own
// routes and may not import from `app` (docs/ARCHITECTURE.md §2).
import type { ComponentType } from 'react';
import type { LazyRouteFunction, RouteObject } from 'react-router';
import { ensureMessages, type LazyNamespace } from '@/i18n';

/**
 * `lazy` for a route whose screen is the named export of a module: one chunk per screen.
 *
 * `namespaces` are the feature string namespaces the screen reads (TEC-01): they load in parallel
 * with the screen chunk, and the route resolves only once both have, so a screen never renders
 * before its strings exist.
 *
 * Always the *function* form of `lazy`: React Router mutates a `lazy` *object* in place
 * (`route.lazy.Component = undefined` once loaded), so route objects shared by several routers
 * (tests, the router being re-created) would lose their screens and 404.
 */
export function lazyScreen<M, K extends keyof M & string>(
  load: () => Promise<M>,
  exportName: K & (M[K] extends ComponentType ? K : never),
  namespaces: readonly LazyNamespace[] = [],
): LazyRouteFunction<RouteObject> {
  return async () => {
    const [module] = await Promise.all([load(), ensureMessages(...namespaces)]);
    return { Component: module[exportName] as ComponentType };
  };
}
