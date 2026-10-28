import { describe, expect, it } from 'vitest';
import { detectLocale, LOCALES, messages } from './index';

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

  it('every message is a non-empty string', () => {
    for (const locale of LOCALES) {
      const flat = keyPaths(messages(locale)).map((path) =>
        path
          .split('.')
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages(locale)),
      );
      for (const text of flat) expect(typeof text === 'string' && text.length > 0).toBe(true);
    }
  });
});
