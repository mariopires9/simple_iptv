// Protected content (UX-07): streams this app never plays — the list declares DRM
// (`#KODIPROP:inputstream.adaptive.license_*`) or the stream is DASH (`.mpd`). The license keys a
// list may carry are never read or used (docs/SECURITY.md §8): the item is only marked, and Play
// is disabled.
//
// Pure (types only), exported by the core/db barrel. `src/ui` reaches it through the dynamic
// `import('@/core/db')` it already uses, or gets a predicate from the feature (ADR-003).
import { isDashStream } from '@/core/net';
import type { CatalogItem } from './types';

/** The stream fields that decide protection (catalogue items and M3U episodes). */
export interface StreamFlags {
  /** Rows written by older builds may hold another truthy value: any one counts (as playback). */
  drm?: unknown;
  /** Declared container (any string: an unrecognised one falls back to the URL). */
  container?: unknown;
  streamUrl?: unknown;
}

/**
 * The stream is DRM-flagged or DASH: it cannot be played here. DASH is decided by the player's
 * own rule (`isDashStream`, `@/core/net`: declared container, else the URL path's extension), so
 * the mark and the player's refusal always agree.
 */
export function isProtectedStream(stream: StreamFlags): boolean {
  if (stream.drm !== undefined && stream.drm !== null && stream.drm !== false) return true;
  return isDashStream(stream);
}

/**
 * A catalogue item shown as protected: its own stream is protected, or — a series grouped from an
 * M3U list (VOD-04) — every episode is (`allEpisodesProtected`, set at import). A series with only
 * some protected episodes is not: those are marked on the episode rows.
 */
export function isProtectedItem(item: CatalogItem): boolean {
  if (item.type === 'series' && item.allEpisodesProtected === true) return true;
  return isProtectedStream(item);
}
