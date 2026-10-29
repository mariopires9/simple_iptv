// Stable colour for a name (channel initials LIV-01 AC3, poster fallback tone VOD-01 AC3). Shared
// since TEC-02.
import type { AvatarColors } from './theme/tokens';

/** Stable palette entry for a name (FNV-1a hash), so an item always gets the same colours. */
export function colorsForName(name: string, palette: readonly AvatarColors[]): AvatarColors {
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const colors = palette[hash % palette.length];
  if (colors === undefined) throw new RangeError('Empty palette');
  return colors;
}
