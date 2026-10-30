// EPG of the visible rows of a virtualised channel list (EPG-01 AC2), shared by the channel list
// and the guide grid (EPG-04).
import { useEffect, useReducer, useRef, useState } from 'react';
import { log } from '@/core/log';
import { SCROLL_DEBOUNCE_MS, type EpgService } from './epg';
import type { PageCache } from './pageCache';

/** Longest single timer (setTimeout overflows above 2³¹−1 ms). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * EPG of the visible rows `[start, end]` (EPG-01 AC2):
 * - a new range is requested once it has been still for SCROLL_DEBOUNCE_MS; only then are the
 *   requests of rows that left it cancelled (queued ones are never sent);
 * - a page arriving inside the settled range only adds its newly loaded rows: nothing in flight
 *   is aborted or asked twice;
 * - one timer, at the next programme boundary among the visible rows, re-renders them (the next
 *   programme comes from the cache) and asks again for rows whose cached programmes ran out.
 * Returns a counter bumped whenever programmes arrive or a boundary passes.
 */
export function useVisibleEpg(
  epg: EpgService | undefined,
  cache: Pick<PageCache, 'get'>,
  start: number,
  end: number,
  /** Bumped when a page arrives. */
  pages: number,
): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const inFlight = useRef(new Map<string, AbortController>());
  const [settled, setSettled] = useState<{ start: number; end: number }>();
  useEffect(() => (epg ? epg.subscribe(bump) : undefined), [epg]);

  // Debounced range: requests follow only a range that has been still.
  useEffect(() => {
    if (!epg || end < start) return undefined;
    const timer = setTimeout(() => setSettled({ start, end }), SCROLL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [epg, start, end]);

  // Unmount (or another service/cache): cancel what this list asked for.
  useEffect(() => {
    const requests = inFlight.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, [epg, cache]);

  // Settled range, page arrivals and boundaries: ask for the visible rows still missing, and
  // cancel the requests of rows that are no longer in the range.
  useEffect(() => {
    if (!epg || !settled) return;
    const requests = inFlight.current;
    const wanted = new Set<string>();
    for (let index = settled.start; index <= settled.end; index++) {
      const channel = cache.get(index);
      if (!channel) continue;
      wanted.add(channel.key);
      if (requests.has(channel.key) || epg.peek(channel) !== undefined) continue;
      const controller = new AbortController();
      requests.set(channel.key, controller);
      epg
        .load(channel, { signal: controller.signal })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          log.warn('live: loading the EPG of a row failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
        })
        .finally(() => {
          if (requests.get(channel.key) === controller) requests.delete(channel.key);
        });
    }
    for (const [key, controller] of requests) {
      if (wanted.has(key)) continue;
      controller.abort();
      requests.delete(key);
    }
  }, [epg, cache, settled, pages, version]);

  // One timer at the next start/end of a programme among the visible rows.
  useEffect(() => {
    if (!epg || end < start) return undefined;
    const now = Date.now();
    let next = Infinity;
    for (let index = start; index <= end; index++) {
      const channel = cache.get(index);
      const programmes = channel && epg.peek(channel);
      if (!programmes) continue;
      for (const p of programmes) {
        if (p.start > now) next = Math.min(next, p.start);
        else if (p.end > now) next = Math.min(next, p.end);
      }
    }
    if (next === Infinity) return undefined;
    const timer = setTimeout(bump, Math.min(MAX_TIMER_MS, next - now));
    return () => clearTimeout(timer);
  }, [epg, cache, start, end, pages, version]);

  return version;
}
