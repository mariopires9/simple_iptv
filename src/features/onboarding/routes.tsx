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
 * Inside the AppShell: the Settings › Privacy placeholder that "Learn more" opens.
 * TODO(UX-04): moves to features/settings.
 */
export const onboardingShellRoutes: RouteObject[] = [
  {
    path: 'settings/privacy',
    lazy: lazyScreen(() => import('./PrivacyScreen'), 'PrivacyScreen', ['onboarding']),
  },
];
