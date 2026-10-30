// React binding of the parental control store (`@/core/session`, SEC-03) for the catalogue
// screens and Settings.
import { useEffect, useSyncExternalStore } from 'react';
import {
  getParentalSnapshot,
  loadParentalControl,
  subscribeParental,
  type ParentalSnapshot,
} from '@/core/session/parental';
import { log } from '@/core/log';

/** The parental control snapshot; the first use reads it from storage. */
export function useParental(): ParentalSnapshot {
  const current = useSyncExternalStore(subscribeParental, getParentalSnapshot);
  useEffect(() => {
    if (!current.known) {
      loadParentalControl().catch((error: unknown) =>
        log.warn('parental: the setting could not be read', {
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }, [current.known]);
  return current;
}
