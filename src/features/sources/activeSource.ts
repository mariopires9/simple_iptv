// React bindings of the session's active list (`@/core/session`, SRC-08 AC4).
import { useEffect, useSyncExternalStore } from 'react';
import {
  getActiveSourceSnapshot,
  loadActiveSource,
  subscribeActiveSource,
  type ActiveSourceSnapshot,
} from '@/core/session';

export {
  forgetActiveSource,
  refreshActiveSource,
  setActiveSource,
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

/** The effective active list id (`undefined` while unknown or when there is no list). */
export function useActiveSourceId(): string | undefined {
  return useActiveSource().id;
}
