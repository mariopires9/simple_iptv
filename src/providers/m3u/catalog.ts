// Parsed M3U entries → catalogue rows (SRC-04 AC7–AC9, ARCHITECTURE.md §5).
//
// Stable keys (favourites and history survive re-imports):
// - Item `externalId` = 64-bit hash (16 hex chars) of `url + "\n" + name`. Both are part of the
//   identity: the same URL listed under two names stays two items, and a renamed channel or a
//   rotated URL token produces a new key (unavoidable without a provider id). An exact duplicate
//   (same URL and name, e.g. one channel listed in two groups) gets `-2`, `-3`… in list order,
//   so every entry is kept.
// - Category `externalId` = `g` + hash of the group name. Entries without `group-title` /
//   `#EXTGRP` go to a synthetic per-source category with the fixed id
//   {@link UNCATEGORIZED_CATEGORY_ID} (AC9), so every item has a `categoryKey`.
// - Categories are per content type, in order of first appearance in the list.
//
// Storage: M3U items keep the full stream URL in plain text (`streamUrl`, and `streamPath` for
// channels/movies, as documented in ARCHITECTURE.md §5 / SECURITY.md §2). Images and catch-up
// templates are only stored when they pass `isStorableUrl` (no list credentials).
import type {
  CatalogItemInput,
  CatalogReplacement,
  CategoryInput,
  ContentType,
  StreamContainer,
} from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import type { M3uEntry } from './parser';

/** Category id of entries without a group (AC9). Never collides with `g…` hashed ids. */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';
/** Stored name of the synthetic category; the UI may localise it by its id. */
export const UNCATEGORIZED_CATEGORY_NAME = 'Uncategorized';

/**
 * Non-cryptographic 64-bit hash (two 32-bit lanes, cyrb53-style mixing) as 16 hex characters.
 * Deterministic across runs and platforms; collisions are negligible for lists of 10^6 entries.
 */
export function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Base external id of an entry (before duplicate numbering). */
export function entryBaseId(url: string, name: string): string {
  return hash64(`${url}\n${name}`);
}

/** External id of a group (category). */
export function groupCategoryId(group: string): string {
  return `g${hash64(group)}`;
}

export interface M3uCatalogOptions {
  /** Return `false` to drop an image / catch-up URL before storing it (e.g. it has credentials). */
  isStorableUrl?: (href: string) => boolean;
}

export type M3uCatalog = { [T in ContentType]: CatalogReplacement<T> };

interface Building<T extends ContentType> {
  categories: CategoryInput[];
  categoryIds: Set<string>;
  items: CatalogItemInput<T>[];
}

const building = <T extends ContentType>(): Building<T> => ({
  categories: [],
  categoryIds: new Set(),
  items: [],
});

const EXTENSIONS: Partial<Record<StreamContainer, string>> = {
  ts: 'ts',
  mp4: 'mp4',
  mkv: 'mkv',
  webm: 'webm',
  flv: 'flv',
  mov: 'mov',
  avi: 'avi',
};

function positiveInt(value: string | undefined, max: number): number | undefined {
  if (value === undefined || !/^\d{1,7}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 && n <= max ? n : undefined;
}

/** Accumulates entries and produces the per-type replacement for `catalogRepo`. */
export class M3uCatalogBuilder {
  private readonly live = building<'live'>();
  private readonly movie = building<'movie'>();
  private readonly series = building<'series'>();
  private readonly seen = new Map<string, number>();
  private readonly isStorableUrl: (href: string) => boolean;

  constructor(options: M3uCatalogOptions = {}) {
    this.isStorableUrl = options.isStorableUrl ?? (() => true);
  }

  /** Items added so far (all types). */
  get size(): number {
    return this.live.items.length + this.movie.items.length + this.series.items.length;
  }

  private externalId(entry: M3uEntry): string {
    const base = entryBaseId(entry.url, entry.name);
    const count = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }

  private image(href: string | undefined): string | undefined {
    if (href === undefined) return undefined;
    const parsed = parseExternalUrl(href, 'image');
    if (!parsed.ok || !this.isStorableUrl(parsed.url.href)) return undefined;
    return parsed.url.href;
  }

  private category<T extends ContentType>(target: Building<T>, group: string | undefined): string {
    const id = group === undefined ? UNCATEGORIZED_CATEGORY_ID : groupCategoryId(group);
    if (!target.categoryIds.has(id)) {
      target.categoryIds.add(id);
      target.categories.push({ externalId: id, name: group ?? UNCATEGORIZED_CATEGORY_NAME });
    }
    return id;
  }

  /** Flags shared by every type; only stored when set (keeps rows small). */
  private flags(entry: M3uEntry) {
    const flags: {
      streamUrl: string;
      container?: StreamContainer;
      drm?: boolean;
      requiredHeaders?: M3uEntry['requiredHeaders'];
      audioOnly?: boolean;
    } = { streamUrl: entry.url };
    if (entry.container !== undefined) flags.container = entry.container;
    if (entry.drm) flags.drm = true;
    if (entry.requiredHeaders.length > 0) flags.requiredHeaders = entry.requiredHeaders;
    if (entry.audioOnly) flags.audioOnly = true;
    return flags;
  }

  add(entry: M3uEntry): void {
    const externalId = this.externalId(entry);
    const { attrs } = entry;
    switch (entry.type) {
      case 'live': {
        const item: CatalogItemInput<'live'> = {
          externalId,
          name: entry.name,
          streamPath: entry.url,
          ...this.flags(entry),
          categoryExternalId: this.category(this.live, entry.group),
        };
        const logo = this.image(attrs.tvgLogo);
        if (logo !== undefined) item.logo = logo;
        const number = positiveInt(attrs.tvgChno, 1_000_000);
        if (number !== undefined) item.number = number;
        if (attrs.tvgId !== undefined) item.epgId = attrs.tvgId;
        if (
          attrs.catchup !== undefined ||
          attrs.catchupDays !== undefined ||
          attrs.timeshift !== undefined
        ) {
          const catchup: { days?: number; source?: string } = {};
          const days = positiveInt(attrs.catchupDays ?? attrs.timeshift, 365);
          if (days !== undefined) catchup.days = days;
          if (attrs.catchupSource !== undefined) {
            const parsed = parseExternalUrl(attrs.catchupSource, 'stream');
            // Validated as a URL, stored as written: `{utc}`-style placeholders must survive.
            if (parsed.ok && this.isStorableUrl(attrs.catchupSource)) {
              catchup.source = attrs.catchupSource;
            }
          }
          item.catchup = catchup;
        }
        this.live.items.push(item);
        return;
      }
      case 'movie': {
        const item: CatalogItemInput<'movie'> = {
          externalId,
          name: entry.name,
          streamPath: entry.url,
          ...this.flags(entry),
          categoryExternalId: this.category(this.movie, entry.group),
        };
        const poster = this.image(attrs.tvgLogo);
        if (poster !== undefined) item.poster = poster;
        const ext = entry.container !== undefined ? EXTENSIONS[entry.container] : undefined;
        if (ext !== undefined) item.ext = ext;
        this.movie.items.push(item);
        return;
      }
      case 'series': {
        const item: CatalogItemInput<'series'> = {
          externalId,
          name: entry.name,
          ...this.flags(entry),
          categoryExternalId: this.category(this.series, entry.group),
        };
        const cover = this.image(attrs.tvgLogo);
        if (cover !== undefined) item.cover = cover;
        this.series.items.push(item);
        return;
      }
    }
  }

  build(): M3uCatalog {
    const out = <T extends ContentType>(b: Building<T>): CatalogReplacement<T> => ({
      categories: b.categories,
      items: b.items,
    });
    return { live: out(this.live), movie: out(this.movie), series: out(this.series) };
  }
}
