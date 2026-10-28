import { describe, expect, it } from 'vitest';
import { categoryKey, itemKey, normalizeName, parseCategoryKey, parseItemKey } from './keys';
import type { ContentType } from './types';

describe('chaves compostas', () => {
  it.each<[string, ContentType, string | number]>([
    ['src-1', 'live', '123'],
    ['src-1', 'movie', 42],
    ['0b3c-uuid', 'series', 'abc:def:ghi'],
    ['s', 'live', 'categoria:7'],
  ])('itemKey/parseItemKey fazem ida e volta (%s, %s, %s)', (sourceId, type, ext) => {
    const key = itemKey(sourceId, type, ext);
    expect(key).toBe(`${sourceId}:${type}:${ext}`);
    expect(parseItemKey(key)).toEqual({ sourceId, type, externalId: String(ext) });
  });

  it.each<[string, ContentType, string]>([
    ['src-1', 'live', '5'],
    ['src-1', 'movie', 'a:b'],
  ])('categoryKey/parseCategoryKey fazem ida e volta (%s, %s, %s)', (sourceId, type, ext) => {
    const key = categoryKey(sourceId, type, ext);
    expect(key).toBe(`${sourceId}:${type}:cat:${ext}`);
    expect(parseCategoryKey(key)).toEqual({ sourceId, type, externalId: ext });
  });

  it('são estáveis entre chamadas (re-sincronização)', () => {
    expect(itemKey('s', 'live', 1)).toBe(itemKey('s', 'live', '1'));
  });

  it('parseItemKey rejeita chaves de categoria (…:cat:…)', () => {
    expect(parseItemKey(categoryKey('s', 'live', 5))).toBeUndefined();
    expect(parseItemKey('s:movie:cat:x:y')).toBeUndefined();
  });

  it('itemKey rejeita externalId começado por "cat:" (seria ambíguo)', () => {
    expect(() => itemKey('s', 'live', 'cat:7')).toThrow(TypeError);
  });

  it('rejeita partes inválidas', () => {
    expect(() => itemKey('a:b', 'live', '1')).toThrow(TypeError);
    expect(() => itemKey('', 'live', '1')).toThrow(TypeError);
    expect(() => itemKey('s', 'live', '')).toThrow(TypeError);
    expect(() => itemKey('s', 'radio' as ContentType, '1')).toThrow(TypeError);
  });

  it.each(['', 'semseparador', 's:live', 's:live:', ':live:1', 's:radio:1'])(
    'parseItemKey devolve undefined para "%s"',
    (key) => {
      expect(parseItemKey(key)).toBeUndefined();
    },
  );

  it('parseCategoryKey só aceita chaves de categoria', () => {
    expect(parseCategoryKey('s:live:1')).toBeUndefined();
    expect(parseCategoryKey('s:live:cat:')).toBeUndefined();
  });

  it('normalizeName remove acentos, maiúsculas e espaços extra', () => {
    expect(normalizeName('  RTP   Notícias ')).toBe('rtp noticias');
    expect(normalizeName('Ação & Ópera')).toBe('acao & opera');
    // Só marcas combinatórias: símbolos "diacríticos" isolados (^, `, ¨) mantêm-se.
    expect(normalizeName('C^3 `X` ¨')).toBe('c^3 `x` ¨');
  });
});
