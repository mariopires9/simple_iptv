import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from './catalogs';
import type { Messages } from './en';
import { enEager } from './en/eager';
import {
  activeLocale,
  detectLocale,
  ensureMessages,
  isMessagesLoaded,
  LAZY_NAMESPACES,
  loadAllMessages,
  LOCALES,
  setLocale,
  subscribeLocale,
  t,
  unloadMessagesForTests,
} from './index';
import { ptPT } from './pt-PT';
import { ptPTEager } from './pt-PT/eager';
import type { MessageShape } from './types';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe('detectLocale', () => {
  it.each([
    [['pt-BR'], 'pt-PT'],
    [['pt'], 'pt-PT'],
    [['pt-PT', 'en'], 'pt-PT'],
    [['en-GB'], 'en'],
    [['fr'], 'en'],
    [['fr-FR', 'pt-BR'], 'pt-PT'],
    [[], 'en'],
  ] as const)('%j → %s', (languages, expected) => {
    expect(detectLocale(undefined, languages)).toBe(expected);
  });

  it('treats "system" like no preference', () => {
    expect(detectLocale('system', ['pt-BR'])).toBe('pt-PT');
  });

  it('lets an explicit preference win over the browser languages', () => {
    expect(detectLocale('en', ['pt-PT'])).toBe('en');
    expect(detectLocale('pt-PT', ['en-GB'])).toBe('pt-PT');
  });
});

describe('messages', () => {
  it('every locale has exactly the same key paths as the base locale (en)', () => {
    const base = keyPaths(messages('en'));
    expect(base.length).toBeGreaterThan(0);
    for (const locale of LOCALES) expect(keyPaths(messages(locale))).toEqual(base);
  });

  it('every message is a non-empty string, or a function returning one', () => {
    for (const locale of LOCALES) {
      const flat = keyPaths(messages(locale)).map((path) =>
        path
          .split('.')
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages(locale)),
      );
      for (const message of flat) {
        const text: unknown =
          typeof message === 'function' ? (message as (arg: string) => unknown)('42') : message;
        expect(typeof text === 'string' && text.length > 0).toBe(true);
      }
    }
  });

  it('message functions interpolate their argument in every locale', () => {
    for (const locale of LOCALES) {
      expect(messages(locale).routes.categoryLabel('123')).toContain('123');
      expect(messages(locale).routes.itemLabel('9')).toContain('9');
    }
    expect(messages('en').routes.categoryLabel('123')).toBe('Category: 123');
    expect(messages('pt-PT').routes.categoryLabel('123')).toBe('Categoria: 123');
  });
});

// TEC-01 AC2: the completeness check between en and pt-PT still fails on a missing key, for the
// eager and the lazily loaded namespaces alike (type-level: an unused `@ts-expect-error` fails
// the typecheck if the error ever disappears).
describe('completeness check (type-level)', () => {
  it('fails on a missing key in a lazy namespace and in an eager one', () => {
    const missingLive: Omit<typeof ptPT.live, 'title'> = ptPT.live;
    const missingNested: Omit<typeof ptPT.state, 'actions'> = ptPT.state;
    const completeCatalog = ptPT satisfies MessageShape<Messages>;
    // @ts-expect-error — `live.title` is missing.
    const incompleteLive = { ...ptPT, live: missingLive } satisfies MessageShape<Messages>;
    // @ts-expect-error — `state.actions` is missing.
    const incompleteState = { ...ptPT, state: missingNested } satisfies MessageShape<Messages>;
    const incompleteEager = {
      ...ptPTEager,
      // @ts-expect-error — the eager pt-PT catalog must match the eager en one too.
      state: missingNested,
    } satisfies MessageShape<typeof enEager>;
    expect([completeCatalog, incompleteLive, incompleteState, incompleteEager]).toHaveLength(4);
  });
});

// TEC-01 AC1/AC3: the app's `t` holds the feature namespaces once loaded, for the active locale.
describe('t and ensureMessages (app registry)', () => {
  afterEach(async () => {
    await setLocale('en');
    await loadAllMessages();
  });

  it('declares every non-eager namespace of the catalog as lazy', () => {
    const lazy = Object.keys(messages('en')).filter((ns) => !(ns in enEager));
    expect([...LAZY_NAMESPACES].sort()).toEqual(lazy.sort());
  });

  it('loads a namespace onto t; the dev guard throws before that', async () => {
    unloadMessagesForTests();
    expect(isMessagesLoaded('live')).toBe(false);
    expect(() => t.live).toThrow(/ensureMessages\('live'\)/);
    expect(t.routes).toBe(messages('en').routes);
    await ensureMessages('live', 'player');
    expect(t.live).toBe(messages('en').live);
    expect(t.player).toBe(messages('en').player);
  });

  it('setLocale switches eager and loaded lazy namespaces, then notifies', async () => {
    unloadMessagesForTests();
    await ensureMessages('movies');
    const listener = vi.fn();
    const unsubscribe = subscribeLocale(listener);
    await setLocale('pt-PT');
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(activeLocale()).toBe('pt-PT');
    expect(t.movies).toBe(messages('pt-PT').movies);
    expect(t.routes).toBe(messages('pt-PT').routes);
    expect(isMessagesLoaded('live')).toBe(false);
    await ensureMessages('live');
    expect(t.live).toBe(messages('pt-PT').live);
  });
});
