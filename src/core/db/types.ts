// Tipos persistidos na base `simple-iptv` — docs/ARCHITECTURE.md §5.
// Campos opcionais quando as fontes (Xtream/M3U) podem não os fornecer.

export type ContentType = 'live' | 'movie' | 'series';
export const CONTENT_TYPES: readonly ContentType[] = ['live', 'movie', 'series'];

// ---------------------------------------------------------------------------
// Fontes
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
  /** Referência para o cofre (tabela `secrets`); ausente em fontes sem segredo (ex.: ficheiro M3U). */
  secretRef?: string;
  epgUrl?: string;
  prefs: SourcePrefs;
  createdAt: number;
  lastSyncAt?: number;
  lastSyncStatus: SyncStatus;
  /** Código de erro da última sincronização (nunca dados sensíveis). */
  lastSyncError?: string;
  stats: SourceStats;
}

// ---------------------------------------------------------------------------
// Cofre (core/crypto)
// ---------------------------------------------------------------------------

export interface SecretRecord {
  ref: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export interface KeyRecord {
  id: string;
  /** CryptoKey não exportável (guardada por structured clone). */
  key: CryptoKey;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface Category {
  /** `${sourceId}:${type}:cat:${externalId}` */
  key: string;
  sourceId: string;
  type: ContentType;
  externalId: string;
  name: string;
  /** Posição na lista original da fonte. */
  order: number;
}

interface CatalogItemBase {
  /** `${sourceId}:${type}:${externalId}` — estável entre sincronizações. */
  key: string;
  sourceId: string;
  externalId: string;
  categoryKey?: string;
  name: string;
  /** Posição na lista original da fonte. */
  order: number;
}

export interface Channel extends CatalogItemBase {
  type: 'live';
  /** Nome normalizado (minúsculas, sem acentos) para pesquisa/ordenação. */
  nameNorm: string;
  logo?: string;
  number?: number;
  epgId?: string;
  /** Xtream: id + extensão; M3U: URL em claro (ver ARCHITECTURE.md §5). */
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

/** Campos calculados pelo repositório (chaves, ordem, nome normalizado). */
type DerivedField = 'key' | 'sourceId' | 'type' | 'order' | 'categoryKey' | 'nameNorm';

/** Item tal como vem do provider: o repositório constrói as chaves compostas. */
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
  /** Chave do episódio (usada em `HistoryEntry.episodeKey`). */
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
// Favoritos, histórico, EPG, definições, pesquisa
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

/** Campos omitidos mantêm o valor guardado; numa entrada nova `completed` é `false` por omissão. */
export interface HistoryUpsert {
  itemKey: string;
  positionSec?: number;
  durationSec?: number;
  episodeKey?: string;
  completed?: boolean;
  /** Por omissão `Date.now()`. */
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

export type Theme = 'system' | 'light' | 'dark';

/** Valores tipados por chave da tabela `settings`. */
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
  /** Índice MiniSearch serializado (`JSON.stringify(index)`). */
  data: string;
  builtAt: number;
}
