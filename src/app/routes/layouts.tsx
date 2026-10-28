import { Outlet } from 'react-router';
import { AppShell } from '../AppShell';
import { FullScreen } from './StatusView';

/** Screens inside the AppShell (top bar + main navigation). */
export function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Full-screen routes without the AppShell (onboarding, docs/UX_UI.md §3). */
export function FullScreenLayout() {
  return (
    <FullScreen>
      <Outlet />
    </FullScreen>
  );
}

/**
 * Shown while a lazy screen loads on the very first render: nothing (UX_UI §5 — short loads do
 * not flash a spinner). Set on every route so the parent layout (AppShell) is already rendered.
 */
export function RouteFallback() {
  return null;
}
