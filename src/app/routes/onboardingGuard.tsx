// Onboarding guard (UX-01 AC1): with no sources, every AppShell route redirects to /onboarding,
// except Settings and its pages (privacy, My lists, add a list).
//
// A component around the shell's outlet rather than a route loader: a loader on the layout would
// hold the whole shell back until the first lazy screen chunk had loaded too. While the first
// check runs (one IndexedDB read) the shell stays visible with an empty content area, like any
// short load (UX_UI §5); the redirect happens only once the answer is known. The answer is cached
// by features/sources and updated when a source is added or removed, so later navigations are
// synchronous.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { log } from '@/core/log';
import {
  getSourcesPresenceSnapshot,
  hasSources,
  subscribeSourcesPresent,
} from '@/features/sources';

export const ONBOARDING_PATH = '/onboarding';

/** Background retry interval after a failed check (the user is let through meanwhile). */
export const GUARD_RETRY_MS = 5_000;

/** Routes reachable without any source: Settings and everything under it. */
export function isOnboardingExempt(pathname: string): boolean {
  // Routes match case-insensitively (FND-04), so the exemption does too.
  const path = pathname.toLowerCase();
  return path === '/settings' || path.startsWith('/settings/');
}

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { present, version } = useSyncExternalStore(
    subscribeSourcesPresent,
    getSourcesPresenceSnapshot,
  );
  const exempt = isOnboardingExempt(pathname);
  // Path whose check failed: never lock the user out because storage could not be read (the
  // screens report storage errors). Not latched: the next navigation checks again, a retry runs in
  // the background, and any answer published later wins.
  const [failedOn, setFailedOn] = useState<string | undefined>();
  const failedHere = failedOn === pathname;

  useEffect(() => {
    if (present !== undefined || exempt || failedHere) return undefined;
    let current = true;
    hasSources().catch((error: unknown) => {
      log.warn('Onboarding guard: could not read the sources', { error });
      if (current) setFailedOn(pathname);
    });
    return () => {
      current = false;
    };
    // `version`: a new snapshot (e.g. an invalidation while a read was in flight) re-checks.
  }, [present, version, exempt, failedHere, pathname]);

  useEffect(() => {
    if (!failedHere || present !== undefined) return undefined;
    const timer = setInterval(() => {
      hasSources().catch(() => undefined);
    }, GUARD_RETRY_MS);
    return () => clearInterval(timer);
  }, [failedHere, present]);

  if (exempt || present === true) return children;
  if (present === false) return <Navigate to={ONBOARDING_PATH} replace />;
  if (failedHere) return children;
  return null;
}
