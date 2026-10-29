// Test helpers of features/sources (SRC-08; imported by tests only): saved lists in
// fake-indexeddb and a router around the "My lists" page.
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, type RouteObject } from 'react-router';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, settingsRepo, sourcesRepo, type Source } from '@/core/db';
import { ToastProvider } from '@/ui/state';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { ThemeModeProvider } from '@/ui/theme';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function makeSource(source: Partial<Source> & Pick<Source, 'id' | 'kind' | 'name'>): Source {
  return {
    prefs: { liveFormat: 'auto' },
    createdAt: 1,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
    ...source,
  };
}

/** Saves a list (with a vault secret when `secret` is given) and a small live catalogue. */
export async function seedSource(source: Source, secret?: string): Promise<Source> {
  if (secret !== undefined && source.secretRef !== undefined) {
    await credentialVault.put(source.secretRef, secret);
  }
  await sourcesRepo.put(source);
  await catalogRepo.replaceForSource(source.id, 'live', {
    categories: [{ externalId: '1', name: `${source.name} news` }],
    items: [{ externalId: '1', categoryExternalId: '1', name: 'Channel 1', streamPath: '1.ts' }],
  });
  return source;
}

export async function setStoredActive(id: string): Promise<void> {
  await settingsRepo.set('activeSourceId', id);
}

export function LocationProbe() {
  const { pathname } = useLocation();
  return <h1>Probe {pathname}</h1>;
}

/** Renders `routes` (plus a catch-all probe) at `path`, inside the app's providers. */
export function renderRoutes(routes: RouteObject[], path: string, width = 1400) {
  const media = installMatchMedia({ width });
  const router = createMemoryRouter([...routes, { path: '*', Component: LocationProbe }], {
    initialEntries: [path],
  });
  const view = render(
    <ThemeModeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeModeProvider>,
  );
  return { ...view, router, media, user: userEvent.setup() };
}
