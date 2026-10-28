// Short loads never flash (UX-02 AC2, docs/UX_UI.md §5): the loading indicator only appears once
// the load has lasted `delayMs` (300 ms by default).
import { useEffect, useState, type ReactNode } from 'react';

export const LOADING_DELAY_MS = 300;

/** `true` once `active` has stayed true for `delayMs`; back to `false` as soon as it turns false. */
export function useDelayedFlag(active: boolean, delayMs: number = LOADING_DELAY_MS): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);
  return active && elapsed;
}

export interface DelayedLoadingProps {
  /** The loading UI (usually a skeleton) shown once the delay has elapsed. */
  children: ReactNode;
  /** Defaults to true: mount the component only while loading, or toggle this. */
  loading?: boolean;
  delayMs?: number;
}

/** Renders nothing for the first `delayMs`, then `children`. */
export function DelayedLoading({
  children,
  loading = true,
  delayMs = LOADING_DELAY_MS,
}: DelayedLoadingProps) {
  return useDelayedFlag(loading, delayMs) ? <>{children}</> : null;
}
