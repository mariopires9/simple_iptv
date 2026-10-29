// Query rules shared by the search screen (SCH-02). Mirrors `isSearchableQuery` in
// src/worker/search/searchIndex.ts without importing the index (MiniSearch stays in the worker).

/** Shortest query, in letters and digits, that runs a search (SCH-02 AC2). */
export const MIN_QUERY_CHARS = 2;

/** Debounce between typing and searching (SCH-02 AC2). */
export const SEARCH_DEBOUNCE_MS = 120;

/** Hits per group on the grouped view, and on a single type's "see all" view. */
export const GROUP_LIMIT = 20;
export const SEE_ALL_LIMIT = 200;

export function isSearchable(query: string): boolean {
  const letters = query
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return letters.length >= MIN_QUERY_CHARS;
}
