// Quick channel filter (LIV-04): substring match on the normalised name (case and accents
// ignored, `normalizeName`) within the current category, with an exact channel-number match
// first for numeric input.
//
// Why in memory and not an IndexedDB query: the `channels` store only has a single-field
// `nameNorm` index (core/db schema v1), which gives prefix ranges over the whole catalogue —
// neither substring matches ("sport" in "eurosport") nor a per-category scope. A per-keystroke
// cursor over a 20 000-channel category would read every record each time (hundreds of ms).
// Instead, the first use in a category reads it once (one index walk per source category) into a
// compact index (key, normalised name, number — no logos/URLs) kept by that category's
// `PageCache`; each keystroke then filters arrays in memory (a few ms for 20 000 rows, measured
// in channelFilter.test.ts) and the matching rows are read back by primary key, a page at a time.
import { catalogRepo, normalizeName, type Channel } from '@/core/db';
import type { ChannelPager } from './pagers';

/** Rows read per step while building the index. */
export const INDEX_CHUNK = 2_000;

export interface FilterIndex {
  readonly size: number;
  /** Keys of the matching channels in display order (exact number matches first). */
  match(query: string): string[];
}

interface Columns {
  keys: string[];
  names: string[];
  numbers: string[];
}

function addRows(columns: Columns, rows: readonly Channel[]): void {
  for (const c of rows) {
    columns.keys.push(c.key);
    // Older or in-memory records may lack `nameNorm`.
    columns.names.push(typeof c.nameNorm === 'string' ? c.nameNorm : normalizeName(c.name));
    columns.numbers.push(c.number !== undefined ? String(c.number) : '');
  }
}

function indexOf({ keys, names, numbers }: Columns): FilterIndex {
  return {
    size: keys.length,
    match(query) {
      const q = normalizeName(query);
      if (q === '') return [...keys];
      const exact: string[] = [];
      const rest: string[] = [];
      const numeric = /^\d+$/.test(q);
      // "007" and "7" are the same channel number.
      const wanted = numeric ? String(Number(q)) : '';
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i] as string;
        const number = numbers[i] as string;
        if (numeric && number === wanted) exact.push(key);
        else if ((names[i] as string).includes(q) || (numeric && number.startsWith(q))) {
          rest.push(key);
        }
      }
      return exact.length === 0 ? rest : exact.concat(rest);
    },
  };
}

/** Index over `channels` (tests; the app builds it from a pager). */
export function createFilterIndex(channels: readonly Channel[]): FilterIndex {
  const columns: Columns = { keys: [], names: [], numbers: [] };
  addRows(columns, channels);
  return indexOf(columns);
}

/**
 * Reads every row of `pager` into a filter index; only three columns are kept. Category by
 * category when the pager can `scan` (one source category's records are in memory at a time),
 * else in `INDEX_CHUNK` pages.
 */
export async function buildFilterIndex(pager: ChannelPager): Promise<FilterIndex> {
  const columns: Columns = { keys: [], names: [], numbers: [] };
  if (pager.scan) {
    await pager.scan((rows) => addRows(columns, rows));
    return indexOf(columns);
  }
  for (let offset = 0; offset < pager.total; offset += INDEX_CHUNK) {
    const rows = await pager.load(offset, INDEX_CHUNK);
    if (rows.length === 0) break;
    addRows(columns, rows);
  }
  return indexOf(columns);
}

/** Pager over the matching keys: each page is one primary-key `bulkGet`. */
export function keysPager(keys: readonly string[]): ChannelPager {
  return {
    total: keys.length,
    load: (offset, limit) => catalogRepo.getMany('live', keys.slice(offset, offset + limit)),
    locate: (channel) => Promise.resolve(keys.indexOf(channel.key)),
  };
}
