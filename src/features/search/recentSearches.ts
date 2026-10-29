// Recent global searches (SCH-02 AC4): the last 10, most recent first, stored on this device in
// the `recentSearches` setting. The stored value is untrusted (validated on every read).
import { settingsRepo } from '@/core/db';

export const MAX_RECENT_SEARCHES = 10;
/** Longer entries are cut (a search field is not a place for paragraphs). */
export const MAX_RECENT_LENGTH = 100;

/** Trims and collapses whitespace; `''` when nothing is left. */
export function cleanQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_RECENT_LENGTH);
}

/** Valid entries of a stored value (strings, non-empty, deduplicated, at most 10). */
export function parseRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const clean = cleanQuery(entry);
    if (clean === '' || out.some((q) => q.toLowerCase() === clean.toLowerCase())) continue;
    out.push(clean);
    if (out.length === MAX_RECENT_SEARCHES) break;
  }
  return out;
}

/** `query` first, without an earlier copy (case-insensitive), at most 10. */
export function withRecentSearch(list: readonly string[], query: string): string[] {
  const clean = cleanQuery(query);
  if (clean === '') return [...list];
  const rest = list.filter((q) => q.toLowerCase() !== clean.toLowerCase());
  return [clean, ...rest].slice(0, MAX_RECENT_SEARCHES);
}

// Reads and writes go through one queue (read-modify-write each time): a change made before the
// first read resolves is applied to the stored list, never to an empty one, and is never
// overwritten by that read.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function read(): Promise<string[]> {
  return parseRecentSearches(await settingsRepo.get('recentSearches'));
}

export function loadRecentSearches(): Promise<string[]> {
  return enqueue(read);
}

/** Applies `change` to the stored list (after any earlier change) and resolves the new list. */
export function updateRecentSearches(
  change: (list: readonly string[]) => string[],
): Promise<string[]> {
  return enqueue(async () => {
    const next = parseRecentSearches(change(await read()));
    if (next.length === 0) await settingsRepo.remove('recentSearches');
    else await settingsRepo.set('recentSearches', next);
    return next;
  });
}
