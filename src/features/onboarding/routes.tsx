// Routes of features/onboarding (FND-04), composed by src/app/router.tsx
// at the top level (full screen, outside the AppShell).
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const onboardingRoutes: RouteObject[] = [
  { path: '/onboarding', lazy: lazyScreen(() => import('./OnboardingScreen'), 'OnboardingScreen') },
];
