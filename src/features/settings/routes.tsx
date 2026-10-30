// Routes of features/settings (FND-04, UX-04), composed by src/app/router.tsx
// inside the AppShell layout (paths relative to `/`).
import type { RouteObject } from 'react-router';
import { lazyScreen } from '@/ui/lazyScreen';

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    lazy: lazyScreen(() => import('./SettingsScreen'), 'SettingsScreen', [
      'settings',
      'install',
      'parental',
    ]),
  },
  {
    path: 'settings/privacy',
    lazy: lazyScreen(() => import('./PrivacyScreen'), 'PrivacyScreen', ['settings']),
  },
];
