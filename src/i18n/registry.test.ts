// TEC-01: lazily registered message namespaces (load, dedupe, locale reload, dev guard).
import { describe, expect, it, vi } from 'vitest';
import { createMessageRegistry } from './registry';

type Loc = 'en' | 'pt';
interface Eager {
  app: { name: string };
}
interface Lazy {
  live: { title: string };
  movies: { title: string };
}

/** A load the test resolves (or rejects) by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(guard = true) {
  const loaders = {
    live: {
      en: vi.fn(() => Promise.resolve({ title: 'Live TV' })),
      pt: vi.fn(() => Promise.resolve({ title: 'TV em direto' })),
    },
    movies: {
      en: vi.fn(() => Promise.resolve({ title: 'Movies' })),
      pt: vi.fn(() => Promise.resolve({ title: 'Filmes' })),
    },
  };
  const registry = createMessageRegistry<Eager, Lazy, Loc>({
    locale: 'en',
    eager: { en: { app: { name: 'App' } }, pt: { app: { name: 'Aplicação' } } },
    lazy: loaders,
    guard,
  });
  return { registry, loaders };
}

describe('createMessageRegistry — eager namespaces', () => {
  it('has the eager namespaces of the initial locale on t from the start', () => {
    const { registry, loaders } = setup();
    expect(registry.t.app.name).toBe('App');
    expect(registry.getLocale()).toBe('en');
    expect(loaders.live.en).not.toHaveBeenCalled();
  });
});

describe('ensureMessages', () => {
  it("loads the active locale's module and assigns it onto t", async () => {
    const { registry, loaders } = setup();
    expect(registry.isLoaded('live')).toBe(false);
    await registry.ensureMessages('live');
    expect(registry.t.live.title).toBe('Live TV');
    expect(registry.isLoaded('live')).toBe(true);
    expect(loaders.live.pt).not.toHaveBeenCalled();
    expect(loaders.movies.en).not.toHaveBeenCalled();
  });

  it('loads several namespaces in parallel', async () => {
    const { registry } = setup();
    await registry.ensureMessages('live', 'movies');
    expect(registry.t.live.title).toBe('Live TV');
    expect(registry.t.movies.title).toBe('Movies');
  });

  it('is idempotent and dedupes concurrent loads (one loader call)', async () => {
    const { registry, loaders } = setup();
    const load = deferred<{ title: string }>();
    loaders.live.en.mockReturnValueOnce(load.promise);
    const first = registry.ensureMessages('live');
    const second = registry.ensureMessages('live');
    load.resolve({ title: 'Live TV' });
    await Promise.all([first, second]);
    await registry.ensureMessages('live');
    expect(loaders.live.en).toHaveBeenCalledTimes(1);
    expect(registry.t.live.title).toBe('Live TV');
  });

  it('rejects on a failed load and retries on the next call', async () => {
    const { registry, loaders } = setup();
    loaders.live.en.mockRejectedValueOnce(new Error('chunk failed'));
    await expect(registry.ensureMessages('live')).rejects.toThrow('chunk failed');
    expect(registry.isLoaded('live')).toBe(false);
    await registry.ensureMessages('live');
    expect(registry.t.live.title).toBe('Live TV');
    expect(loaders.live.en).toHaveBeenCalledTimes(2);
  });

  it('with no namespaces resolves at once', async () => {
    const { registry } = setup();
    await expect(registry.ensureMessages()).resolves.toBeUndefined();
  });

  it('loadAll loads every lazy namespace; unloadAll removes them again', async () => {
    const { registry } = setup();
    await registry.loadAll();
    expect(registry.t.live.title).toBe('Live TV');
    expect(registry.t.movies.title).toBe('Movies');
    registry.unloadAll();
    expect(registry.isLoaded('live')).toBe(false);
    expect(() => registry.t.live).toThrow(/ensureMessages\('live'\)/);
  });
});

describe('dev guard', () => {
  it('throws a clear error when a lazy namespace is read before ensureMessages', () => {
    const { registry } = setup(true);
    expect(() => registry.t.live.title).toThrow(
      'i18n: namespace "live" read before ensureMessages(\'live\')',
    );
  });

  it('does not affect eager namespaces, "in" checks or unknown keys', () => {
    const { registry } = setup(true);
    expect(registry.t.app.name).toBe('App');
    expect('live' in registry.t).toBe(false);
    expect((registry.t as unknown as Record<string, unknown>).other).toBeUndefined();
  });

  it('without the guard (production) an unloaded namespace is just absent', () => {
    const { registry } = setup(false);
    expect((registry.t as Partial<Lazy>).live).toBeUndefined();
  });
});

describe('setLocale', () => {
  it('reloads the loaded namespaces for the new locale, swaps all strings, then notifies', async () => {
    const { registry, loaders } = setup();
    await registry.ensureMessages('live');
    const listener = vi.fn(() => {
      // Notified only once every string is in the new locale.
      expect(registry.t.app.name).toBe('Aplicação');
      expect(registry.t.live.title).toBe('TV em direto');
    });
    registry.subscribe(listener);
    await registry.setLocale('pt');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getLocale()).toBe('pt');
    expect(loaders.live.pt).toHaveBeenCalledTimes(1);
    // Not loaded before the switch: not loaded by it either.
    expect(loaders.movies.pt).not.toHaveBeenCalled();
    // Namespaces loaded after the switch follow the active locale.
    await registry.ensureMessages('movies');
    expect(registry.t.movies.title).toBe('Filmes');
  });

  it('keeps the old strings until the new locale has loaded', async () => {
    const { registry, loaders } = setup();
    await registry.ensureMessages('live');
    const load = deferred<{ title: string }>();
    loaders.live.pt.mockReturnValueOnce(load.promise);
    const switching = registry.setLocale('pt');
    await Promise.resolve();
    expect(registry.getLocale()).toBe('en');
    expect(registry.t.live.title).toBe('Live TV');
    expect(registry.t.app.name).toBe('App');
    load.resolve({ title: 'TV em direto' });
    await switching;
    expect(registry.t.live.title).toBe('TV em direto');
  });

  it('is a no-op for the active locale', async () => {
    const { registry } = setup();
    const listener = vi.fn();
    registry.subscribe(listener);
    await registry.setLocale('en');
    expect(listener).not.toHaveBeenCalled();
  });

  it('a namespace loading during the switch ends up in the new locale', async () => {
    const { registry, loaders } = setup();
    await registry.ensureMessages('live');
    const enMovies = deferred<{ title: string }>();
    loaders.movies.en.mockReturnValueOnce(enMovies.promise);
    const ensuring = registry.ensureMessages('movies'); // starts in en
    const switching = registry.setLocale('pt');
    enMovies.resolve({ title: 'Movies' });
    await Promise.all([ensuring, switching]);
    expect(registry.getLocale()).toBe('pt');
    expect(registry.t.movies.title).toBe('Filmes');
    expect(registry.t.live.title).toBe('TV em direto');
  });

  it('a later switch supersedes one still loading', async () => {
    const { registry, loaders } = setup();
    await registry.ensureMessages('live');
    const slow = deferred<{ title: string }>();
    loaders.live.pt.mockReturnValueOnce(slow.promise);
    const listener = vi.fn();
    registry.subscribe(listener);
    const toPt = registry.setLocale('pt');
    const backToEn = registry.setLocale('en');
    slow.resolve({ title: 'TV em direto' });
    await Promise.all([toPt, backToEn]);
    expect(registry.getLocale()).toBe('en');
    expect(registry.t.live.title).toBe('Live TV');
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops the notifications', async () => {
    const { registry } = setup();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    unsubscribe();
    await registry.setLocale('pt');
    expect(listener).not.toHaveBeenCalled();
  });
});
