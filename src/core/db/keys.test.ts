import { describe, expect, it } from 'vitest';
import { categoryKey, itemKey, normalizeName, parseCategoryKey, parseItemKey } from './keys';
import type { ContentType } from './types';

describe('composite keys', () => {
  it.each<[string, ContentType, string | number]>([
    ['src-1', 'live', '123'],
    ['src-1', 'movie', 42],
    ['0b3c-uuid', 'series', 'abc:def:ghi'],
    ['s', 'live', 'category:7'],
  ])('itemKey/parseItemKey round-trip (%s, %s, %s)', (sourceId, type, ext) => {
    const key = itemKey(sourceId, type, ext);
    expect(key).toBe(`${sourceId}:${type}:${ext}`);
    expect(parseItemKey(key)).toEqual({ sourceId, type, externalId: String(ext) });
  });

  it.each<[string, ContentType, string]>([
    ['src-1', 'live', '5'],
    ['src-1', 'movie', 'a:b'],
  ])('categoryKey/parseCategoryKey round-trip (%s, %s, %s)', (sourceId, type, ext) => {
    const key = categoryKey(sourceId, type, ext);
    expect(key).toBe(`${sourceId}:${type}:cat:${ext}`);
    expect(parseCategoryKey(key)).toEqual({ sourceId, type, externalId: ext });
  });

  it('are stable across calls (re-sync)', () => {
    expect(itemKey('s', 'live', 1)).toBe(itemKey('s', 'live', '1'));
  });

  it('parseItemKey rejects category keys (…:cat:…)', () => {
    expect(parseItemKey(categoryKey('s', 'live', 5))).toBeUndefined();
    expect(parseItemKey('s:movie:cat:x:y')).toBeUndefined();
  });

  it('itemKey rejects an externalId starting with "cat:" (would be ambiguous)', () => {
    expect(() => itemKey('s', 'live', 'cat:7')).toThrow(TypeError);
  });

  it('rejects invalid parts', () => {
    expect(() => itemKey('a:b', 'live', '1')).toThrow(TypeError);
    expect(() => itemKey('', 'live', '1')).toThrow(TypeError);
    expect(() => itemKey('s', 'live', '')).toThrow(TypeError);
    expect(() => itemKey('s', 'radio' as ContentType, '1')).toThrow(TypeError);
  });

  it.each(['', 'noseparator', 's:live', 's:live:', ':live:1', 's:radio:1'])(
    'parseItemKey returns undefined for "%s"',
    (key) => {
      expect(parseItemKey(key)).toBeUndefined();
    },
  );

  it('parseCategoryKey only accepts category keys', () => {
    expect(parseCategoryKey('s:live:1')).toBeUndefined();
    expect(parseCategoryKey('s:live:cat:')).toBeUndefined();
  });

  it('normalizeName removes diacritics, uppercase and extra whitespace', () => {
    expect(normalizeName('  RTP   Notícias ')).toBe('rtp noticias');
    expect(normalizeName('Ação & Ópera')).toBe('acao & opera');
    // Only combining marks: standalone "diacritic" symbols (^, `, ¨) are kept.
    expect(normalizeName('C^3 `X` ¨')).toBe('c^3 `x` ¨');
  });
});
