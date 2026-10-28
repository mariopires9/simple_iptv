// Previous/next channel within the current category (LIV-02 AC2, docs/UX_UI.md §6.2).
import type { Channel } from '@/core/db';
import type { PageCache } from './pageCache';

export interface Positioned {
  channel: Channel;
  /** Row of `channel` in the category, when known. */
  index?: number | undefined;
}

/**
 * Debounce before a zapped channel is resolved and loaded: holding ↑/↓ (or 5 presses in 2 s)
 * opens one stream — the last — instead of one connection per channel, which matters for
 * providers that allow a single connection. The name is shown at once regardless.
 */
export const ZAP_SETTLE_MS = 600;

/** Row of `channel` in the category: the known index, the cached pages, then the pager. */
export async function locate(cache: PageCache, from: Positioned): Promise<number> {
  if (from.index !== undefined && cache.get(from.index)?.key === from.channel.key) {
    return from.index;
  }
  const cached = cache.indexOf(from.channel.key);
  if (cached >= 0) return cached;
  if (from.index !== undefined && from.index < cache.total) return from.index;
  return cache.pager.locate(from.channel);
}

/**
 * The channel `delta` rows away (wrapping around the ends). A channel that is not in this
 * category (picked elsewhere, or restored from the URL) zaps to the first/last row. Pages
 * are crossed through the pager when the neighbour is not cached.
 */
export async function neighbour(
  cache: PageCache,
  from: Positioned,
  delta: 1 | -1,
): Promise<{ channel: Channel; index: number } | undefined> {
  const total = cache.total;
  if (total === 0) return undefined;
  const index = await locate(cache, from);
  const target = index < 0 ? (delta > 0 ? 0 : total - 1) : (index + delta + total) % total;
  const channel = cache.get(target) ?? (await cache.pager.load(target, 1))[0];
  return channel ? { channel, index: target } : undefined;
}
