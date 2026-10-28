// Routes of features/sources (FND-04). Registered by the feature and composed by
// src/app/router.tsx inside the AppShell layout (paths are relative to `/`).
// Every screen is lazy-loaded (its own chunk). Use the `lazy` *function* form: React Router
// mutates a `lazy` *object* in place, which breaks when several routers share these route
// objects (tests, React StrictMode).
import type { RouteObject } from 'react-router';

export const sourcesRoutes: RouteObject[] = [
  {
    path: 'settings/sources',
    lazy: async () => ({ Component: (await import('./SourcesScreen')).SourcesScreen }),
  },
];
