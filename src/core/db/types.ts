// Types persisted in the `simple-iptv` database — docs/ARCHITECTURE.md §5.
// Fields are optional when sources (Xtream/M3U) may not provide them.

export type ContentType = 'live' | 'movie' | 'series';
export const CONTENT_TYPES: readonly ContentType[] = ['live', 'movie', 'series'];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceKind = 'xtream' | 'm3u-url' | 'm3u-file';
export type LiveFormat = 'auto' | 'ts' | 'm3u8';
export type SyncStatus = 'never' | 'syncing' | 'ok' | 'partial' | 'error';

export interface SourcePrefs {
  liveFormat: LiveFormat;
}

export interface SourceStats {
  live: number;
  movies: number;
  series: number;
}

export interface Source {
  /** uuid */
  id: string;
  kind: SourceKind;
  name: string;
  serverUrl?: string;
  username?: string;
  /** Reference into the vault (`secrets` table); absent for sources without a secret (e.g. M3U file). */
  secretRef?: string;
  epgUrl?: string;
  /**
   * EPG (XMLTV) URLs announced by an M3U list header (`url-tvg` / `x-tvg-url`, SRC-04 AC2), in
   * list order. Only URLs without credentials are stored here. Not indexed.
   */
  epgUrls?: string[];
  prefs: SourcePrefs;
  createdAt: number;
  lastSyncAt?: number;
  lastSyncStatus: SyncStatus;
  /** Error code of the last sync (never sensitive data). */
  lastSyncError?: string;
  /** Outcome of the last sync attempt per content type (SRC-07). Not indexed. */
  lastSyncByType?: Partial<Record<ContentType, TypeSyncStatus>>;
  stats: SourceStats;
}

/** Outcome of syncing one content type of a source (SRC-07). Never contains sensitive data. */
export interface TypeSyncStatus {
  status: 'ok' | 'error';
  /** When this type was last attempted (epoch ms). */
  at: number;
  /** Stable error code when `status` is `error` (e.g. a `NetErrorKind` such as `http`). */
  error?: string;
  /** HTTP status for `error: 'http'`. */
  httpStatus?: number;
  /** Items written (after deduplication) on success. */
  items?: number;
  /** Categories written on success. */
  categories?: number;
  /** Invalid items/categories skipped on success. */
  skipped?: number;
  /** When this type was last written successfully (epoch ms); kept across failed attempts. */
  lastOkAt?: number;
}

// ---------------------------------------------------------------------------
// Vault (core/crypto)
// ---------------------------------------------------------------------------

export interface SecretRecord {
  ref: string;
  /** Id (`KeyRecord.kid`) of the device key this secret was encrypted with. Not indexed. */
  kid: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export interface KeyRecord {
  id: string;
  /**
   * Random identity of this key generation (not secret). Lets core/crypto tell "the key this
   * secret needs is gone" apart from "the ciphertext was tampered with". Not indexed.
   */
  kid: string;
  /** Non-extractable CryptoKey (stored via structured clone). */
  key: CryptoKey;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface Category {
  /** `${sourceId}:${type}:cat:${externalId}` */
  key: string;
  sourceId: string;
  type: ContentType;
  externalId: string;
  name: string;
  /** Position in the source's original list. */
  order: number;
}

/**
 * Container of a stream as inferred from its URL (or list hints) — SRC-04 AC8. `dash` (`.mpd`) is
 * recorded so the player can explain it is unsupported instead of failing.
 */
export type StreamContainer =
  | 'hls'
  | 'ts'
  | 'mp4'
  | 'mkv'
  | 'webm'
  | 'flv'
  | 'mov'
  | 'avi'
  | 'dash'
  | 'mp3'
  | 'aac'
  | 'ogg'
  | 'flac';

/** HTTP headers a list says a stream needs (`#EXTVLCOPT`); browsers cannot send them. */
export type RequiredHeader = 'user-agent' | 'referer' | 'origin';

interface CatalogItemBase {
  /** `${sourceId}:${type}:${externalId}` — stable across syncs. */
  key: string;
  sourceId: string;
  externalId: string;
  categoryKey?: string;
  name: string;
  /** Position in the source's original list. */
  order: number;
  // --- M3U playback hints (SRC-04 AC8). Not indexed; absent for Xtream items. ---
  /**
   * M3U only: the full playable URL, stored in plain text (ARCHITECTURE.md §5 decision,
   * SECURITY.md §2). Xtream items never set it (their URL is built in memory with the password).
   */
  streamUrl?: string;
  /** Container inferred from the URL extension / list hints; absent when unknown. */
  container?: StreamContainer;
  /** The list declares DRM (`#KODIPROP:inputstream.adaptive.license_*`): not playable here. */
  drm?: boolean;
  /** Headers the list requires (`#EXTVLCOPT:http-user-agent|http-referrer|http-origin`). */
  requiredHeaders?: RequiredHeader[];
  /** Radio / audio-only stream (`radio="true"` or an audio file extension). */
  audioOnly?: boolean;
}

export interface Channel extends CatalogItemBase {
  type: 'live';
  /** Normalized name (lowercase, no diacritics) for search/sorting. */
  nameNorm: string;
  logo?: string;
  number?: number;
  epgId?: string;
  /** Xtream: id + extension; M3U: empty (the full URL is in `streamUrl`, ARCHITECTURE.md §5). */
  streamPath: string;
  catchup?: { days?: number; source?: string };
}

export interface Movie extends CatalogItemBase {
  type: 'movie';
  poster?: string;
  rating?: number;
  year?: number;
  ext?: string;
  streamPath: string;
  addedAt?: number;
  plot?: string;
  genre?: string;
}

export interface Series extends CatalogItemBase {
  type: 'series';
  cover?: string;
  plot?: string;
  rating?: number;
  year?: number;
  genre?: string;
}

export interface CatalogItemByType {
  live: Channel;
  movie: Movie;
  series: Series;
}

export type CatalogItem = CatalogItemByType[ContentType];

/** Fields computed by the repository (keys, order, normalized name). */
type DerivedField = 'key' | 'sourceId' | 'type' | 'order' | 'categoryKey' | 'nameNorm';

/** Item as it comes from the provider: the repository builds the composite keys. */
export type CatalogItemInput<T extends ContentType> = Omit<CatalogItemByType[T], DerivedField> & {
  categoryExternalId?: string;
};

export interface CategoryInput {
  externalId: string;
  name: string;
}

export interface CatalogReplacement<T extends ContentType> {
  categories: readonly CategoryInput[];
  items: readonly CatalogItemInput<T>[];
}

export interface Episode {
  /** Episode key (used in `HistoryEntry.episodeKey`). */
  key: string;
  externalId: string;
  season: number;
  number: number;
  title: string;
  ext?: string;
  streamPath: string;
  durationSec?: number;
  plot?: string;
  image?: string;
}

export interface Season {
  number: number;
  name?: string;
  cover?: string;
  episodes: Episode[];
}

/** Series-level metadata of `get_series_info` (SER-02). Every field is optional. */
export interface SeriesDetailsInfo {
  plot?: string;
  genre?: string;
  director?: string;
  cast?: string;
  year?: number;
  rating?: number;
  cover?: string;
  backdrop?: string;
}

export interface SeriesDetails {
  seriesKey: string;
  sourceId: string;
  fetchedAt: number;
  seasons: Season[];
  /**
   * Version of the source the details were fetched with (account fields + `lastSyncAt`), so an
   * edited or re-synced source does not reuse them (SER-02). Not indexed.
   */
  identity?: string;
  /** Series-level metadata from the same response. Not indexed. */
  info?: SeriesDetailsInfo;
}

// ---------------------------------------------------------------------------
// Favorites, history, EPG, settings, search
// ---------------------------------------------------------------------------

export interface Favorite {
  itemKey: string;
  sourceId: string;
  type: ContentType;
  addedAt: number;
}

export interface HistoryEntry {
  itemKey: string;
  sourceId: string;
  type: ContentType;
  lastWatchedAt: number;
  positionSec?: number;
  durationSec?: number;
  episodeKey?: string;
  completed: boolean;
}

/** Omitted fields keep the stored value; on a new entry `completed` defaults to `false`. */
export interface HistoryUpsert {
  itemKey: string;
  positionSec?: number;
  durationSec?: number;
  episodeKey?: string;
  completed?: boolean;
  /** Defaults to `Date.now()`. */
  lastWatchedAt?: number;
}

export interface EpgProgram {
  channelEpgId: string;
  start: number;
  end: number;
  sourceId: string;
  title: string;
  desc?: string;
}

/** Theme preferences, in display order. Single source of truth for the `Theme` type. */
export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Typed values per key of the `settings` table. */
export interface SettingsMap {
  theme: Theme;
  activeSourceId: string;
  lastRoute: string;
  lastChannelKey: string;
  onboardingDone: boolean;
  /** Live screen view per source (LIV-03); shape owned and validated by features/live. */
  liveViewState: unknown;
  /** Start the last live channel when the app opens on Live (LIV-03; UI in UX-04). */
  playLastChannelOnOpen: boolean;
  /**
   * Last global searches, most recent first (SCH-02, max. 10). Untrusted on read: owned and
   * validated by features/search.
   */
  recentSearches: unknown;
}

export type SettingsKey = keyof SettingsMap;

export interface SettingsEntry<K extends SettingsKey = SettingsKey> {
  key: K;
  value: SettingsMap[K];
}

export interface SearchIndexEntry {
  sourceId: string;
  /** Serialized MiniSearch index (`JSON.stringify(index)`). */
  data: string;
  builtAt: number;
  /**
   * Format of `data` (SCH-01; owned by src/worker/search). An entry with another (or no) version
   * is rebuilt instead of loaded.
   */
  version?: number;
}
