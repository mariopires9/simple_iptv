// Display names of saved lists (SRC-03/05/08): one rule for adding and renaming.

/** Maximum length of a source name, in code points (docs/SECURITY.md §3: names are truncated). */
export const MAX_SOURCE_NAME_LENGTH = 512;

/** Trimmed and cut by code points (never inside a surrogate pair); empty → `fallback`. */
export function sourceName(name: string, fallback: string): string {
  return Array.from(name.trim() || fallback)
    .slice(0, MAX_SOURCE_NAME_LENGTH)
    .join('');
}
