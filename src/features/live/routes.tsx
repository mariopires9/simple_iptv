// Routes of features/live (FND-04). Registered by the feature and composed by
// src/app/router.tsx inside the AppShell layout (paths are relative to `/`).
// Every screen is lazy-loaded (its own chunk). Use the `lazy` *function* form: React Router
// mutates a `lazy` *object* in place, which breaks when several routers share these route
// objects (tests, React StrictMode).
import type { RouteObject } from 'react-router';

export const liveRoutes: RouteObject[] = [
  { path: 'live', lazy: async () => ({ Component: (await import('./LiveScreen')).LiveScreen }) },
  {
    path: 'live/category/:categoryId',
    lazy: async () => ({ Component: (await import('./LiveScreen')).LiveScreen }),
  },
];
