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

interface CatalogItemBase {
  /** `${sourceId}:${type}:${externalId}` — stable across syncs. */
  key: string;
  sourceId: string;
  externalId: string;
  categoryKey?: string;
  name: string;
  /** Position in the source's original list. */
  order: number;
}

export interface Channel extends CatalogItemBase {
  type: 'live';
  /** Normalized name (lowercase, no diacritics) for search/sorting. */
  nameNorm: string;
  logo?: string;
  number?: number;
  epgId?: string;
  /** Xtream: id + extension; M3U: plain URL (see ARCHITECTURE.md §5). */
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

export interface SeriesDetails {
  seriesKey: string;
  sourceId: string;
  fetchedAt: number;
  seasons: Season[];
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
}
