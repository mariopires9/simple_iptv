// Onboarding guard (UX-01 AC1): with no sources, every AppShell route redirects to /onboarding,
// except Settings and its pages (privacy, My lists, add a list).
//
// A component in the shell layout rather than a route loader: a loader on the layout would hold
// the whole shell back until the first lazy screen chunk had loaded too (blank page on slow
// networks). The answer is cached by features/sources (one IndexedDB read per session, updated
// when a source is added or removed), so after the first check every navigation is synchronous.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { log } from '@/core/log';
import { getSourcesPresent, hasSources, subscribeSourcesPresent } from '@/features/sources';

export const ONBOARDING_PATH = '/onboarding';

/** Routes reachable without any source: Settings and everything under it. */
export function isOnboardingExempt(pathname: string): boolean {
  // Routes match case-insensitively (FND-04), so the exemption does too.
  const path = pathname.toLowerCase();
  return path === '/settings' || path.startsWith('/settings/');
}

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const present = useSyncExternalStore(subscribeSourcesPresent, getSourcesPresent);
  const [checkFailed, setCheckFailed] = useState(false);
  const exempt = isOnboardingExempt(pathname);

  useEffect(() => {
    if (present !== undefined || exempt || checkFailed) return;
    hasSources().catch((error: unknown) => {
      // Never lock the user out because the check failed: the screens report storage errors.
      log.warn('Onboarding guard: could not read the sources', { error });
      setCheckFailed(true);
    });
  }, [present, exempt, checkFailed]);

  if (exempt || present === true || checkFailed) return children;
  if (present === false) return <Navigate to={ONBOARDING_PATH} replace />;
  // First check in flight (one IndexedDB read): nothing, like any short load (UX_UI §5).
  return null;
}
