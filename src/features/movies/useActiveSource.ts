// React binding of the session active list (`@/core/session`, SRC-08 AC4) for the Movies screens.
// Copied from features/live (features cannot import each other; candidate for a shared extraction).
import { useEffect, useSyncExternalStore } from 'react';
import {
  getActiveSourceSnapshot,
  loadActiveSource,
  subscribeActiveSource,
  type ActiveSourceSnapshot,
} from '@/core/session';

/** The active list snapshot; the first use resolves it from storage. */
export function useActiveSource(): ActiveSourceSnapshot {
  const current = useSyncExternalStore(subscribeActiveSource, getActiveSourceSnapshot);
  useEffect(() => {
    if (!current.known) loadActiveSource().catch(() => undefined);
  }, [current.known]);
  return current;
}
