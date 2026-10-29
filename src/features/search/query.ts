// Search screen timings and limits (SCH-02). The "is this query long enough" rule is shared with
// the worker: `isSearchableQuery` in @/core/db.

/** Debounce between typing and searching (SCH-02 AC2). */
export const SEARCH_DEBOUNCE_MS = 120;

/** Hits per group on the grouped view, and on a single type's "see all" view. */
export const GROUP_LIMIT = 20;
export const SEE_ALL_LIMIT = 200;
