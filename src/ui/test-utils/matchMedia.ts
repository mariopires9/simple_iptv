// Test-only `window.matchMedia` for jsdom (which has none). Evaluates the media features the app
// uses — min/max-width, prefers-color-scheme, prefers-reduced-motion — against a fake
// environment that tests can change at runtime (listeners are notified).

export interface FakeMediaEnvironment {
  width: number;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  reducedMotion?: boolean;
}

function evaluateFeature(feature: string, env: FakeMediaEnvironment): boolean {
  const match = /^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/.exec(feature.trim());
  if (!match) return false;
  const [, name, value = ''] = match;
  switch (name) {
    case 'min-width':
      return env.width >= Number.parseFloat(value);
    case 'max-width':
      return env.width <= Number.parseFloat(value);
    case 'prefers-color-scheme':
      return (env.colorScheme ?? 'no-preference') === value;
    case 'prefers-reduced-motion':
      return value === 'reduce' ? env.reducedMotion === true : env.reducedMotion !== true;
    default:
      return false;
  }
}

export function evaluateMediaQuery(query: string, env: FakeMediaEnvironment): boolean {
  return query
    .replace(/^@media\s*/, '')
    .split(/\s+and\s+/)
    .every((feature) => evaluateFeature(feature, env));
}

/** Installs the fake on `window.matchMedia`; returns a setter and a restore function. */
export function installMatchMedia(initial: FakeMediaEnvironment) {
  let env = { ...initial };
  const lists = new Set<{ query: string; notify: () => void }>();
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  const matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mql = {
      media: query,
      get matches() {
        return evaluateMediaQuery(query, env);
      },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    lists.add({
      query,
      notify: () => {
        const event = { matches: mql.matches, media: query } as MediaQueryListEvent;
        for (const listener of listeners) listener(event);
      },
    });
    return mql;
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });

  return {
    set(next: Partial<FakeMediaEnvironment>) {
      env = { ...env, ...next };
      for (const list of lists) list.notify();
    },
    restore() {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
