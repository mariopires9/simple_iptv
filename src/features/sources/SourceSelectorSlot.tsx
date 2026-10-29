// The top-bar slot of the list selector (SRC-08). Statically reachable from the app shell, so the
// selector itself (menu, dialog, its storage reads) is a lazy chunk: the initial bundle only gets
// this wrapper. Renders nothing until the chunk and the lists have loaded — and nothing while the
// chunk cannot be loaded (e.g. offline right after an update) or if the selector fails: the shell
// must never break because of it. A failed load is retried on the next navigation and when the
// browser comes back online (TEC-01). Its strings are eager (`t.lists`).
import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { log } from '@/core/log';

export type SelectorLoader = () => Promise<ComponentType>;

const loadSourceSelector: SelectorLoader = () =>
  import('./SourceSelector').then((module) => module.SourceSelector);

/** Loaded selectors, per loader: later mounts render at once. Failures are not cached. */
const loaded = new WeakMap<SelectorLoader, ComponentType>();
const pending = new WeakMap<SelectorLoader, Promise<ComponentType>>();

function load(loader: SelectorLoader): Promise<ComponentType> {
  let promise = pending.get(loader);
  if (!promise) {
    promise = loader().then(
      (component) => {
        loaded.set(loader, component);
        return component;
      },
      (error: unknown) => {
        pending.delete(loader); // retry on the next attempt
        throw error;
      },
    );
    pending.set(loader, promise);
  }
  return promise;
}

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  return () => window.removeEventListener('online', onChange);
};
const getOnline = () => navigator.onLine;

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

export function SourceSelectorSlot({ loader = loadSourceSelector }: { loader?: SelectorLoader }) {
  const [Selector, setSelector] = useState<ComponentType | undefined>(() => loaded.get(loader));
  // Retry triggers while the chunk is missing: each navigation, and going back online.
  const { key } = useLocation();
  const online = useSyncExternalStore(subscribeOnline, getOnline);

  useEffect(() => {
    if (Selector) return;
    let cancelled = false;
    load(loader).then(
      (component) => {
        if (!cancelled) setSelector(() => component);
      },
      (error: unknown) => {
        if (!cancelled) log.warn('The list selector could not be loaded', { error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [Selector, loader, key, online]);

  return <SelectorBoundary>{Selector ? <Selector /> : null}</SelectorBoundary>;
}
