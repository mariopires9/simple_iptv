// The top-bar slot of the list selector (SRC-08). Statically reachable from the app shell, so the
// selector itself (menu, dialog, its storage reads) is a lazy chunk: the initial bundle only gets
// this wrapper. Renders nothing until the chunk and the lists have loaded — and nothing if the
// chunk cannot be loaded (e.g. offline right after an update): the shell must never break for it.
import { Suspense, lazy, type ComponentType } from 'react';
import { log } from '@/core/log';

const Nothing: ComponentType = () => null;

const SourceSelector = lazy(async (): Promise<{ default: ComponentType }> => {
  try {
    return { default: (await import('./SourceSelector')).SourceSelector };
  } catch (error) {
    log.warn('The list selector could not be loaded', { error });
    return { default: Nothing };
  }
});

export function SourceSelectorSlot() {
  return (
    <Suspense fallback={null}>
      <SourceSelector />
    </Suspense>
  );
}
