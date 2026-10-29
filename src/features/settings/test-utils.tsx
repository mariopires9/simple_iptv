// Test helpers of features/settings (imported by tests only): a themed, toast-enabled memory router.
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';

/** Renders `element` at `/settings` (with `/settings/sources` and `/settings/privacy` stubs). */
export function renderSettings(element: ReactElement) {
  const router = createMemoryRouter(
    [
      { path: '/settings', element },
      { path: '/settings/sources', element: <h1>My lists page</h1> },
      { path: '/settings/privacy', element: <h1>Privacy page</h1> },
    ],
    { initialEntries: ['/settings'] },
  );
  const view = render(
    <ThemeModeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeModeProvider>,
  );
  return { ...view, router };
}
