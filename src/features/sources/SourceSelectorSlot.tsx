// The top-bar slot of the list selector (SRC-08). Statically reachable from the app shell, so the
// selector itself (menu, dialog, its storage reads) is a lazy chunk: the initial bundle only gets
// this wrapper. Renders nothing until the chunk and the lists have loaded — and nothing if the
// chunk cannot be loaded (e.g. offline right after an update) or the selector fails: the shell
// must never break because of it.
import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
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

class SelectorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    log.warn('The list selector failed', { error });
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function SourceSelectorSlot() {
  return (
    <SelectorBoundary>
      <Suspense fallback={null}>
        <SourceSelector />
      </Suspense>
    </SelectorBoundary>
  );
}
