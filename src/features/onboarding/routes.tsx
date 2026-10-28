// Routes of features/onboarding (FND-04). Registered by the feature and composed by
// src/app/router.tsx at the top level (full screen, outside the AppShell).
// Every screen is lazy-loaded (its own chunk). Use the `lazy` *function* form: React Router
// mutates a `lazy` *object* in place, which breaks when several routers share these route
// objects (tests, React StrictMode).
import type { RouteObject } from 'react-router';

export const onboardingRoutes: RouteObject[] = [
  {
    path: '/onboarding',
    lazy: async () => ({ Component: (await import('./OnboardingScreen')).OnboardingScreen }),
  },
];
