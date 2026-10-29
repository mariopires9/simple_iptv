// Poster/backdrop URL checks and the tonal fallback colour (VOD-01 AC3). Adapted from
// features/live/ChannelAvatar.tsx (features cannot import each other; candidate for a shared
// extraction into src/ui later).
import type { AvatarColors } from '@/ui/theme/tokens';

/**
 * Whether the browser can load this image. `https:` and `data:image/…` always; `http:` only when
 * the page itself is not served over HTTPS (mixed content would be blocked or upgraded and fail).
 */
export function isLoadableImage(
  url: string | undefined,
  pageProtocol: string = globalThis.location?.protocol ?? 'https:',
): url is string {
  if (url === undefined || url.trim() === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  switch (parsed.protocol) {
    case 'https:':
      return true;
    case 'http:':
      return pageProtocol !== 'https:';
    case 'data:':
      return parsed.pathname.startsWith('image/');
    default:
      return false;
  }
}

/** Stable palette entry for a name (FNV-1a hash), so a movie always gets the same tone. */
export function toneFor(name: string, palette: readonly AvatarColors[]): AvatarColors {
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const colors = palette[hash % palette.length];
  if (colors === undefined) throw new RangeError('Empty palette');
  return colors;
}
