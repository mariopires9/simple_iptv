// Loads data of the active list for a screen, again whenever the active list changes (SRC-08) or
// `reload()` is called. A reload of the same list keeps showing the previous data until the new
// data arrives (no skeleton flash after removing a favorite or clearing the history); a reload
// after an error (Retry) shows the loading state until the new outcome arrives.
import { useCallback, useEffect, useState } from 'react';
import { log } from '@/core/log';
import { useActiveSource } from '@/ui/hooks/useActiveSource';

export type ListDataState<T> =
  | { status: 'loading' }
  | { status: 'no-source' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; sourceId: string; data: T };

type Outcome<T> =
  { status: 'error'; error: unknown } | { status: 'ready'; sourceId: string; data: T };

export interface ListData<T> {
  state: ListDataState<T>;
  reload: () => void;
  /** The active list right now (`undefined` while unknown or when there is none). */
  activeId: string | undefined;
}

/**
 * `load` must be stable (module function or `useCallback`); `key` identifies any other input of
 * `load` (e.g. the selected tab), so data of another key is never shown.
 */
export function useListData<T>(load: (sourceId: string) => Promise<T>, key = ''): ListData<T> {
  const active = useActiveSource();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ scope: string; version: number; outcome: Outcome<T> }>();
  const sourceId = active.known ? active.id : undefined;
  const scope = `${sourceId ?? ''}\n${key}`;

  useEffect(() => {
    if (sourceId === undefined) return undefined;
    let cancelled = false;
    load(sourceId).then(
      (data) => {
        if (!cancelled) {
          setResult({ scope, version, outcome: { status: 'ready', sourceId, data } });
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        log.warn('favorites: loading the list data failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setResult({ scope, version, outcome: { status: 'error', error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, sourceId, scope, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  let state: ListDataState<T>;
  if (!active.known) state = { status: 'loading' };
  else if (active.id === undefined) state = { status: 'no-source' };
  else if (result?.scope !== scope) state = { status: 'loading' };
  // Retrying: an error is only shown for the current attempt.
  else if (result.outcome.status === 'error' && result.version !== version) {
    state = { status: 'loading' };
  } else state = result.outcome;
  return { state, reload, activeId: sourceId };
}
