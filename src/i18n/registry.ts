// Message registry (TEC-01): one `t` object whose eager namespaces are always present and whose
// lazy (feature) namespaces are assigned onto it when loaded for the active locale. Feature code
// keeps reading `t.<namespace>.<key>`; routes declare the namespaces their screen needs
// (`lazyScreen`, src/ui/lazyScreen.ts) so a screen never renders before its strings exist.

/** Per lazy namespace, one loader per locale (`() => import('./en/live').then((m) => m.live)`). */
export type NamespaceLoaders<L, Loc extends string> = {
  readonly [K in keyof L]: Readonly<Record<Loc, () => Promise<L[K]>>>;
};

/**
 * Outcome of `setLocale`: `switched` (strings swapped, subscribers notified), `unchanged` (already
 * the active locale) or `superseded` (a later `setLocale` call took over before this one finished
 * loading; nothing was changed by this call).
 */
export type LocaleSwitchResult = 'switched' | 'unchanged' | 'superseded';

/**
 * What a read of a lazy namespace that is not loaded does:
 * - `throw` (development builds, tests): a clear error, so a missing route declaration is caught.
 * - `fallback` (production): never breaks the screen. It starts loading the namespace, reports
 *   it through `onMissing`, and returns the active locale's or the fallback locale's strings if
 *   they have already been loaded, else placeholder messages that read as empty strings.
 */
export type GuardMode = 'throw' | 'fallback';

export interface MessageRegistry<E, L, Loc extends string> {
  /** The messages: eager namespaces always, lazy ones once loaded for the active locale. */
  readonly t: E & L;
  /**
   * Loads the active locale's modules of these namespaces and assigns them onto `t`. Idempotent;
   * concurrent calls share one load per locale and namespace; a failed load can be retried.
   */
  ensureMessages(...namespaces: readonly (keyof L & string)[]): Promise<void>;
  /** Loads every lazy namespace (tests, prefetch). */
  loadAll(): Promise<void>;
  /** Tests only: removes every lazy namespace from `t`, as at startup. */
  unloadAll(): void;
  /** Whether the namespace is on `t` for the active locale. */
  isLoaded(namespace: keyof L & string): boolean;
  getLocale(): Loc;
  /**
   * Switches the locale: reloads every loaded namespace for it, then swaps all strings on `t` at
   * once and notifies the subscribers. A later call supersedes one still loading (see
   * `LocaleSwitchResult`). Rejects, changing nothing, if a namespace cannot be loaded.
   */
  setLocale(locale: Loc): Promise<LocaleSwitchResult>;
  /** Called after each locale switch; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface MessageRegistryOptions<E, L, Loc extends string> {
  locale: Loc;
  eager: Readonly<Record<Loc, E>>;
  lazy: NamespaceLoaders<L, Loc>;
  guard: GuardMode;
  /** `fallback` mode: locale whose already loaded strings stand in for a missing namespace. */
  fallbackLocale?: Loc;
  /** `fallback` mode: called once per namespace read before it was loaded (and on its error). */
  onMissing?: (namespace: string, error?: unknown) => void;
}

/** Placeholder for any message: reads, calls and string conversions all give `''`. */
const emptyMessages: unknown = new Proxy(() => '', {
  get(_target, key) {
    if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf') return () => '';
    if (key === 'then') return undefined; // never look like a promise
    if (typeof key === 'symbol') return undefined;
    return emptyMessages;
  },
  apply: () => '',
});

export function createMessageRegistry<E extends object, L extends object, Loc extends string>(
  options: MessageRegistryOptions<E, L, Loc>,
): MessageRegistry<E, L, Loc> {
  type Namespace = keyof L & string;

  let locale = options.locale;
  let switchToken = 0;
  const target: Record<string, unknown> = { ...(options.eager[locale] as Record<string, unknown>) };
  /** Namespaces on `target` for the active locale. */
  const loaded = new Set<Namespace>();
  /** In-flight or settled module loads, per locale and namespace (dedupes concurrent loads). */
  const modules = new Map<string, Promise<unknown>>();
  /** Modules that have resolved, per locale and namespace (synchronous fallback reads). */
  const settled = new Map<string, unknown>();
  /** Namespaces already reported through `onMissing`. */
  const reported = new Set<string>();
  const listeners = new Set<() => void>();
  const lazyNames = new Set<string>(Object.keys(options.lazy));
  const moduleKey = (forLocale: Loc, namespace: string) => `${forLocale}\u0000${namespace}`;

  function missing(namespace: Namespace): unknown {
    if (options.guard === 'throw') {
      throw new Error(
        `i18n: namespace "${namespace}" read before ensureMessages('${namespace}'). Declare it ` +
          `in the route's lazyScreen namespaces (or await ensureMessages before rendering).`,
      );
    }
    if (!reported.has(namespace)) {
      reported.add(namespace);
      options.onMissing?.(namespace);
    }
    ensureOne(namespace).catch((error: unknown) => options.onMissing?.(namespace, error));
    for (const candidate of [locale, options.fallbackLocale]) {
      const key = candidate === undefined ? undefined : moduleKey(candidate, namespace);
      if (key !== undefined && settled.has(key)) return settled.get(key);
    }
    return emptyMessages;
  }

  const t = new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === 'string' && lazyNames.has(key) && !loaded.has(key as Namespace)) {
        return missing(key as Namespace);
      }
      return Reflect.get(object, key, receiver) as unknown;
    },
  }) as E & L;

  function loadModule(forLocale: Loc, namespace: Namespace): Promise<unknown> {
    const key = moduleKey(forLocale, namespace);
    let pending = modules.get(key);
    if (!pending) {
      pending = options.lazy[namespace][forLocale]().then(
        (module) => {
          settled.set(key, module);
          return module;
        },
        (error: unknown) => {
          modules.delete(key); // let a later call retry (e.g. offline right after an update)
          throw error;
        },
      );
      modules.set(key, pending);
    }
    return pending;
  }

  async function ensureOne(namespace: Namespace): Promise<void> {
    while (!loaded.has(namespace)) {
      const forLocale = locale;
      const module = await loadModule(forLocale, namespace);
      // The locale changed while loading: load the new locale's module instead.
      if (locale !== forLocale) continue;
      target[namespace] = module;
      loaded.add(namespace);
    }
  }

  return {
    t,
    async ensureMessages(...namespaces) {
      await Promise.all(namespaces.map(ensureOne));
    },
    loadAll() {
      return this.ensureMessages(...([...lazyNames] as Namespace[]));
    },
    unloadAll() {
      for (const namespace of loaded) delete target[namespace];
      loaded.clear();
    },
    isLoaded: (namespace) => loaded.has(namespace),
    getLocale: () => locale,
    async setLocale(next) {
      const token = ++switchToken;
      if (next === locale) return 'unchanged';
      for (;;) {
        const names = [...loaded];
        const loadedModules = await Promise.all(names.map((ns) => loadModule(next, ns)));
        if (token !== switchToken) return 'superseded';
        // A namespace loaded (for the old locale) meanwhile: reload it for the new one too.
        if ([...loaded].some((ns) => !names.includes(ns))) continue;
        locale = next;
        Object.assign(target, options.eager[next]);
        // Only namespaces still loaded now: one unloaded meanwhile stays unloaded.
        names.forEach((ns, i) => {
          if (loaded.has(ns)) target[ns] = loadedModules[i];
        });
        break;
      }
      for (const listener of [...listeners]) listener();
      return 'switched';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
