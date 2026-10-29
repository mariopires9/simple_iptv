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
// - Series episodes (VOD-04 AC3): entries classified as series with an episode marker are grouped
//   into one series row per show — `externalId` = `s` + hash of the normalised show name + "\n" +
//   the group without season tokens (the same show in two unrelated groups stays two series; "Show
//   T1" / "Show T2" groups are one) — placed where its first episode
//   appears. Its seasons/episodes are returned in `seriesDetails` and stored with the catalogue
//   (read by the Series details screen, no network call). An episode's `externalId` is the entry's
//   own id above (url + name), so its history key (`episodeItemKey`) does not depend on list order
//   and resume survives a re-import. Series entries without a marker stay one row each, as before.
//
// Storage: M3U items keep the full stream URL once, in plain text, in `streamUrl` (ARCHITECTURE.md
// §5 / SECURITY.md §2); the required `streamPath` of channels/movies is left empty (players read
// `streamUrl ?? streamPath`). Images and catch-up templates are only stored when they pass
// `isStorableUrl` (no list credentials).
import type {
  CatalogItemInput,
  CatalogReplacement,
  CategoryInput,
  ContentType,
  EpisodeInput,
  SeriesDetailsInput,
  StreamContainer,
} from '@/core/db';
import { isProtectedStream } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import { showGroupIdentity, showIdentity } from './classify';
import type { M3uEntry } from './parser';

/** Category id of entries without a group (AC9). Never collides with `g…` hashed ids. */
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';
/**
 * Stored name of the synthetic category: empty (language-neutral). The UI shows a localised label
 * for a category with id {@link UNCATEGORIZED_CATEGORY_ID} and an empty name.
 */
export const UNCATEGORIZED_CATEGORY_NAME = '';

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

/**
 * External id of a grouped show (VOD-04): its normalised name within its group, the group without
 * season tokens ("T1", "S02", "Season 2", "Temporada 2").
 */
export function showSeriesId(
  show: string,
  group: string | undefined,
  groupIdentity: string = showGroupIdentity(group),
): string {
  // Season tokens of the group are ignored ("Show T1" / "Show T2" groups: one show).
  return `s${hash64(`${showIdentity(show)}\n${groupIdentity}`)}`;
}

/** External id of a group (category). */
export function groupCategoryId(group: string): string {
  return `g${hash64(group)}`;
}

export interface M3uCatalogOptions {
  /** Return `false` to drop an image / catch-up URL before storing it (e.g. it has credentials). */
  isStorableUrl?: (href: string) => boolean;
}

export type M3uCatalog = { [T in ContentType]: CatalogReplacement<T> } & {
  /** Seasons/episodes of the grouped shows (VOD-04 AC3), sorted by number. */
  seriesDetails: SeriesDetailsInput[];
};

/** A grouped show while the list is read. */
interface Show {
  item: CatalogItemInput<'series'>;
  seasons: Map<number, EpisodeInput[]>;
}

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
  private readonly shows = new Map<string, Show>();
  private readonly showIds = new Map<string, string>();
  /** Group → identity without season tokens (computed once per group). */
  private readonly groupIds = new Map<string, string>();
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
          streamPath: '',
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
          streamPath: '',
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
        if (entry.episode !== undefined) {
          this.addEpisode(entry, externalId);
          return;
        }
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

  /** Adds a series entry with an episode marker to its show (created on its first episode). */
  private addEpisode(entry: M3uEntry, externalId: string): void {
    const info = entry.episode as NonNullable<M3uEntry['episode']>;
    // Cached per show name + group: the identity normalisation runs once per show.
    const cacheKey = `${info.show}\n${entry.group ?? ''}`;
    let showId = this.showIds.get(cacheKey);
    if (showId === undefined) {
      const group = entry.group ?? '';
      let groupIdentity = this.groupIds.get(group);
      if (groupIdentity === undefined) {
        groupIdentity = showGroupIdentity(entry.group);
        this.groupIds.set(group, groupIdentity);
      }
      showId = showSeriesId(info.show, entry.group, groupIdentity);
      this.showIds.set(cacheKey, showId);
    }
    const image = this.image(entry.attrs.tvgLogo);
    let show = this.shows.get(showId);
    if (show === undefined) {
      const item: CatalogItemInput<'series'> = {
        externalId: showId,
        name: info.show,
        categoryExternalId: this.category(this.series, entry.group),
      };
      if (image !== undefined) item.cover = image;
      show = { item, seasons: new Map() };
      this.shows.set(showId, show);
      this.series.items.push(item);
    } else if (show.item.cover === undefined && image !== undefined) {
      show.item.cover = image;
    }
    const { streamUrl, ...flags } = this.flags(entry);
    const episode: EpisodeInput = {
      externalId,
      season: info.season,
      number: info.episode,
      title: info.title,
      streamPath: '',
      streamUrl,
      ...flags,
    };
    const ext = entry.container !== undefined ? EXTENSIONS[entry.container] : undefined;
    if (ext !== undefined) episode.ext = ext;
    if (entry.duration !== undefined && entry.duration > 0) {
      episode.durationSec = Math.round(entry.duration);
    }
    if (image !== undefined) episode.image = image;
    const season = show.seasons.get(info.season);
    if (season === undefined) show.seasons.set(info.season, [episode]);
    else season.push(episode);
  }

  build(): M3uCatalog {
    const out = <T extends ContentType>(b: Building<T>): CatalogReplacement<T> => ({
      categories: b.categories,
      items: b.items,
    });
    const seriesDetails: SeriesDetailsInput[] = [];
    for (const [seriesExternalId, show] of this.shows) {
      const seasons = [...show.seasons]
        .sort(([a], [b]) => a - b)
        .map(([number, episodes]) => ({
          number,
          // Stable sort: equal numbers (e.g. HD and SD copies) keep list order.
          episodes: episodes.sort((a, b) => a.number - b.number),
        }));
      show.item.seasonCount = seasons.length;
      // UX-07: a show whose every episode is DRM/DASH is protected as a whole.
      if (seasons.every((s) => s.episodes.every(isProtectedStream))) {
        show.item.allEpisodesProtected = true;
      }
      seriesDetails.push({ seriesExternalId, seasons });
    }
    return {
      live: out(this.live),
      movie: out(this.movie),
      series: out(this.series),
      seriesDetails,
    };
  }
}
