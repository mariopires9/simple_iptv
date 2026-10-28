// Chaves compostas do catálogo — docs/ARCHITECTURE.md §5.
// Item: `${sourceId}:${type}:${externalId}` · Categoria: `${sourceId}:${type}:cat:${externalId}`.
// São determinísticas: a mesma fonte produz as mesmas chaves em cada sincronização,
// por isso favoritos e histórico sobrevivem a re-sincronizações.
import { CONTENT_TYPES, type ContentType } from './types';

const SEP = ':';
const CATEGORY_MARKER = 'cat';

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

/** Chave de um item do catálogo (canal, filme ou série). */
export function itemKey(sourceId: string, type: ContentType, externalId: string | number): string {
  const ext = String(externalId);
  assertParts(sourceId, type, ext);
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

/**
 * Decompõe uma chave de item. O `externalId` pode conter `:` (tudo o que vem depois do tipo).
 * Devolve `undefined` se a chave não for válida.
 */
export function parseItemKey(key: string): ParsedItemKey | undefined {
  const first = key.indexOf(SEP);
  if (first <= 0) return undefined;
  const second = key.indexOf(SEP, first + 1);
  if (second < 0) return undefined;
  const sourceId = key.slice(0, first);
  const type = key.slice(first + 1, second);
  const externalId = key.slice(second + 1);
  if (!isContentType(type) || externalId === '') return undefined;
  return { sourceId, type, externalId };
}

/** Decompõe uma chave de categoria; `undefined` se não for uma chave de categoria válida. */
export function parseCategoryKey(key: string): ParsedCategoryKey | undefined {
  const parsed = parseItemKey(key);
  const marker = `${CATEGORY_MARKER}${SEP}`;
  if (!parsed || !parsed.externalId.startsWith(marker)) return undefined;
  const externalId = parsed.externalId.slice(marker.length);
  if (externalId === '') return undefined;
  return { ...parsed, externalId };
}

/** Normaliza um nome para pesquisa/ordenação: minúsculas, sem acentos, espaços colapsados. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
