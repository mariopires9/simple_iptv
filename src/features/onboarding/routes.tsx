// Routes of features/onboarding (FND-04, UX-01), composed by src/app/router.tsx.
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

/** Top level (full screen, outside the AppShell). */
export const onboardingRoutes: RouteObject[] = [
  {
    path: '/onboarding',
    lazy: lazyScreen(() => import('./OnboardingScreen'), 'OnboardingScreen', ['onboarding']),
  },
];

/**
 * Inside the AppShell: none since UX-04 (the Settings › Privacy page moved to features/settings).
 * Kept, empty, because src/app/router.tsx (serialized) still spreads it; remove both together.
 */
export const onboardingShellRoutes: RouteObject[] = [];
