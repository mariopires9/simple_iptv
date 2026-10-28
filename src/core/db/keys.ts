// Chaves compostas do catálogo — docs/ARCHITECTURE.md §5.
// Item: `${sourceId}:${type}:${externalId}` · Categoria: `${sourceId}:${type}:cat:${externalId}`.
// São determinísticas: a mesma fonte produz as mesmas chaves em cada sincronização,
// por isso favoritos e histórico sobrevivem a re-sincronizações.
import { CONTENT_TYPES, type ContentType } from './types';

const SEP = ':';
const CATEGORY_MARKER = 'cat';
const CATEGORY_PREFIX = `${CATEGORY_MARKER}${SEP}`;

export interface ParsedItemKey {
  sourceId: string;
  type: ContentType;
  externalId: string;
}

export type ParsedCategoryKey = ParsedItemKey;

function assertParts(sourceId: string, type: ContentType, externalId: string): void {
  if (sourceId === '' || sourceId.includes(SEP)) {
    throw new TypeError(`sourceId inválido para chave composta: "${sourceId}"`);
  }
  if (!CONTENT_TYPES.includes(type)) {
    throw new TypeError(`Tipo de conteúdo inválido: "${String(type)}"`);
  }
  if (externalId === '') {
    throw new TypeError('externalId vazio em chave composta');
  }
}

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Chave de um item do catálogo (canal, filme ou série). Um `externalId` começado por `cat:` é
 * rejeitado: a chave seria indistinguível de uma chave de categoria.
 */
export function itemKey(sourceId: string, type: ContentType, externalId: string | number): string {
  const ext = String(externalId);
  assertParts(sourceId, type, ext);
  if (ext.startsWith(CATEGORY_PREFIX)) {
    throw new TypeError(`externalId de item não pode começar por "${CATEGORY_PREFIX}"`);
  }
  return `${sourceId}${SEP}${type}${SEP}${ext}`;
}

/** Chave de uma categoria. */
export function categoryKey(
  sourceId: string,
  type: ContentType,
  externalId: string | number,
): string {
  const ext = String(externalId);
  assertParts(sourceId, type, ext);
  return `${sourceId}${SEP}${type}${SEP}${CATEGORY_MARKER}${SEP}${ext}`;
}

/** Prefixo comum a todas as chaves de uma fonte (útil para apagar por prefixo). */
export function sourcePrefix(sourceId: string): string {
  return `${sourceId}${SEP}`;
}

/** Prefixo comum às chaves de itens e categorias de uma fonte+tipo. */
export function typePrefix(sourceId: string, type: ContentType): string {
  return `${sourceId}${SEP}${type}${SEP}`;
}

/** Decompõe `${sourceId}:${type}:${resto}` sem validar o resto. */
function splitKey(key: string): ParsedItemKey | undefined {
  const first = key.indexOf(SEP);
  if (first <= 0) return undefined;
  const second = key.indexOf(SEP, first + 1);
  if (second < 0) return undefined;
  const type = key.slice(first + 1, second);
  if (!isContentType(type)) return undefined;
  return { sourceId: key.slice(0, first), type, externalId: key.slice(second + 1) };
}

/**
 * Decompõe uma chave de item. O `externalId` pode conter `:` (tudo o que vem depois do tipo).
 * Devolve `undefined` se a chave não for válida ou se for uma chave de categoria (`…:cat:…`).
 */
export function parseItemKey(key: string): ParsedItemKey | undefined {
  const parsed = splitKey(key);
  if (!parsed || parsed.externalId === '' || parsed.externalId.startsWith(CATEGORY_PREFIX)) {
    return undefined;
  }
  return parsed;
}

/** Decompõe uma chave de categoria; `undefined` se não for uma chave de categoria válida. */
export function parseCategoryKey(key: string): ParsedCategoryKey | undefined {
  const parsed = splitKey(key);
  if (!parsed || !parsed.externalId.startsWith(CATEGORY_PREFIX)) return undefined;
  const externalId = parsed.externalId.slice(CATEGORY_PREFIX.length);
  if (externalId === '') return undefined;
  return { ...parsed, externalId };
}

/**
 * Normaliza um nome para pesquisa/ordenação: minúsculas, sem acentos, espaços colapsados.
 * Remove só marcas combinatórias (`\p{M}`) após NFD; outros símbolos (ex.: `^`, `` ` ``) mantêm-se.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
