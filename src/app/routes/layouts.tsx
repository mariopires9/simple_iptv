import { Outlet, ScrollRestoration } from 'react-router';
import { AppShell } from '../AppShell';
import { FullScreen } from './FullScreen';
import { OnboardingGuard } from './onboardingGuard';

// <ScrollRestoration> (data routers, SPA: renders nothing, no inline script): new navigations
// start at the top; back/forward restore the saved window scroll position (sessionStorage).
// Each top-level layout renders it, so exactly one is mounted at any time.

/** Screens inside the AppShell (top bar + main navigation); without sources → onboarding. */
export function ShellLayout() {
  return (
    <AppShell>
      <ScrollRestoration />
      {/* Inside the shell: the chrome stays visible while the first check runs. */}
      <OnboardingGuard>
        <Outlet />
      </OnboardingGuard>
    </AppShell>
  );
}

/** Full-screen routes without the AppShell (onboarding, docs/UX_UI.md §3). */
export function FullScreenLayout() {
  return (
    <FullScreen>
      <ScrollRestoration />
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
