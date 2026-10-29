// Live / movie / series classification of M3U entries (VOD-04, docs/ARCHITECTURE.md §5 "M3U
// classification"). Runs in the data worker, once per entry, inside the streaming parser.
//
// An M3U list says nothing reliable about what an entry is, so the decision is a short chain of
// heuristics, strongest first. The first rule that decides wins:
//
//   1. URL path (Xtream pattern): `/movie/` → movie, `/series/` → series, `/live/` → live.
//   2. Audio-only entries (`radio="true"`, audio file extension) → live (radios).
//   3. Group title (see {@link DEFAULT_M3U_RULES}): a live word anywhere ("24/7", "Live", "Canais",
//      "Ao vivo"…) → live; else a VOD keyword among the first significant words ("VOD", "Movies",
//      "Filmes", "Series", "Séries"…) → movie / series / VOD.
//   4. `media="true"` (Kodi IPTV Simple's VOD attribute, used by real Portuguese lists) → VOD.
//   5. VOD file extension (`.mp4`, `.mkv`, `.avi`, `.mov`, `.m4v`) → VOD.
//   6. A strong episode marker in the name (`S01E02`, `S01 E02`, `T01E02`, "Temporada 1
//      Episódio 2") → series.
//   7. Anything else is uncertain → live (AC4: the safe default; nothing is hidden from Live).
//
// "VOD" means movie, unless the name carries an episode marker (then series). The weak marker
// `1x02` only counts once another rule said VOD/series: on its own it is too often a score.
//
// Series entries with an episode marker also yield the show name (text before the marker,
// without quality tags such as "4K"/"HD") and the episode title (text after it), so the catalogue
// builder can group episodes into one series per show and season.
//
// Cost: O(1) per entry — a few anchored regular expressions on the name and URL path; the group
// decision is cached per distinct group string by the caller ({@link M3uClassifier}).
import type { ContentType, StreamContainer } from '@/core/db';
import { tokenizeSearchText } from '@/core/db';

/** What a group title says about its entries. `vod`: movie, or series when the name has a marker. */
export type GroupKind = 'live' | 'movie' | 'series' | 'vod';

/**
 * Configurable classification rules (the "rules table"). Words are compared after normalisation
 * (lower case, diacritics removed, punctuation as separators — `tokenizeSearchText`), so "Séries",
 * "SERIES" and "séries" are the same word. A two-word entry ("tv shows") matches two consecutive
 * words.
 */
export interface M3uClassificationRules {
  /** Group words that mark live channels wherever they appear; checked before `groupKeywords`. */
  liveGroupWords: readonly string[];
  /** Group words → kind, matched among the first {@link groupLeadWords} significant words. */
  groupKeywords: Readonly<Record<string, Exclude<GroupKind, 'live'>>>;
  /** How many significant words of a group are inspected for a keyword ("prefix" rule). */
  groupLeadWords: number;
  /**
   * Words skipped when counting significant words: quality tags and similar. Any word of one or
   * two characters (country/language codes "PT", "EN", "4K", "HD") is skipped as well.
   */
  groupNoiseWords: readonly string[];
  /** Containers (from the URL extension) of on-demand files. */
  vodContainers: readonly StreamContainer[];
}

/** Default rules. Changing them only needs a re-sync of the list (no migration). */
export const DEFAULT_M3U_RULES: M3uClassificationRules = {
  liveGroupWords: [
    '24 7',
    '24x7',
    '247',
    'live',
    'ao vivo',
    'en vivo',
    'em direto',
    'en directo',
    'canal',
    'canais',
    'canales',
    'channel',
    'channels',
    'radio',
    'radios',
  ],
  groupKeywords: {
    vod: 'vod',
    movie: 'movie',
    movies: 'movie',
    film: 'movie',
    films: 'movie',
    filme: 'movie',
    filmes: 'movie',
    pelicula: 'movie',
    peliculas: 'movie',
    series: 'series',
    seriados: 'series',
    'tv shows': 'series',
  },
  groupLeadWords: 1,
  groupNoiseWords: ['fhd', 'uhd', 'hevc', 'h264', 'h265', 'vip', 'top', 'new', 'multi'],
  vodContainers: ['mp4', 'mkv', 'avi', 'mov'],
};

export interface EpisodeMarker {
  season: number;
  episode: number;
  /** Index of the marker in the name and its length (to split show name and title). */
  index: number;
  length: number;
}

const NOT_ALNUM_BEFORE = '(?<![\\p{L}\\p{N}])';
/** `S01E02`, `S1 E2`, `S01.E02`, `S01-E02`, `S01 Ep 02`, `S01Ep.2`. */
const SXE = new RegExp(
  `${NOT_ALNUM_BEFORE}S(\\d{1,3})[\\s._-]*E(?:P\\.?)?\\s*(\\d{1,4})(?!\\d)`,
  'iu',
);
/** Portuguese `T01E02` / `T1 E2` (temporada / episódio). */
const TXE = new RegExp(
  `${NOT_ALNUM_BEFORE}T(\\d{1,2})[\\s._-]*E(?:P\\.?)?\\s*(\\d{1,4})(?!\\d)`,
  'iu',
);
/** "Temporada 1 Episódio 2", "Season 2 - Episode 5", "Temp. 1 Ep. 3", "Saison 1 Épisode 4". */
const WORDS = new RegExp(
  `${NOT_ALNUM_BEFORE}(?:temporada|season|saison|staffel|temp\\.?)\\s*(\\d{1,3})\\s*[-–,:|.]?\\s*` +
    `(?:epis[oó]dio|episode|[ée]pisode|episodio|folge|ep\\.?|e)\\s*(\\d{1,4})(?!\\d)`,
  'iu',
);
const HAS_DIGIT = /\d/;
/** Weak `1x02` (episode with two or three digits, so `1x2` scores do not match). */
const NXE = new RegExp(`${NOT_ALNUM_BEFORE}(\\d{1,2})x(\\d{2,3})(?![\\p{L}\\p{N}])`, 'iu');

function markerFrom(match: RegExpExecArray | null): EpisodeMarker | undefined {
  if (!match) return undefined;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode) || episode <= 0) return undefined;
  return { season, episode, index: match.index, length: match[0].length };
}

/** A strong episode marker (`S01E02`, `S01 E02`, `T01E02`, "Temporada 1 Episódio 2"). */
export function strongEpisodeMarker(name: string): EpisodeMarker | undefined {
  // Every marker has digits: most channel names are rejected without running the expressions.
  if (!HAS_DIGIT.test(name)) return undefined;
  return markerFrom(SXE.exec(name)) ?? markerFrom(TXE.exec(name)) ?? markerFrom(WORDS.exec(name));
}

/** Strong marker, else the weak `1x02` form (only used once the entry is known to be VOD). */
export function episodeMarker(name: string): EpisodeMarker | undefined {
  return strongEpisodeMarker(name) ?? markerFrom(NXE.exec(name));
}

/** Quality / format tags at the end of a show name ("Show 4K", "Show [HD]", "Show - 1080p"). */
const TRAILING_TAG =
  /(?:^|[\s\-–—|:._,[(]+)(?:4k|uhd|fhd|hd|sd|hevc|[hx]\.?26[45]|\d{3,4}p|multi|dual|legendado|dublado)[\])]?[\s\-–—|:._,]*$/i;
const EDGE_SEPARATORS = /^[\s\-–—|:._,)\]]+|[\s\-–—|:._,([]+$/g;

/** Cleans the text around a marker: separators at the edges, scene-style dots, quality tags. */
export function cleanShowName(text: string): string {
  let out = text;
  // "Breaking.Bad.S01E01": dots or underscores used as spaces.
  if (!/\s/.test(out.trim()) && /[._]/.test(out)) out = out.replace(/[._]+/g, ' ');
  for (let i = 0; i < 4; i++) {
    const next = out.replace(TRAILING_TAG, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(EDGE_SEPARATORS, '').replace(/\s+/g, ' ').trim();
}

function cleanTitle(text: string): string {
  return text.replace(EDGE_SEPARATORS, '').replace(/\s+/g, ' ').trim();
}

/** Show and episode title of a series entry, split around its marker. */
export interface EpisodeInfo {
  season: number;
  episode: number;
  /** Display name of the show (never empty). */
  show: string;
  /** Episode title: the text after the marker, else the whole entry name. */
  title: string;
}

/**
 * Splits `name` around `marker`. The show is the text before the marker; when that is empty
 * ("S01E02 - Pilot"), the group, then the text after the marker, then the whole name.
 */
export function episodeInfo(
  name: string,
  marker: EpisodeMarker,
  group: string | undefined,
): EpisodeInfo {
  const before = cleanShowName(name.slice(0, marker.index));
  const after = cleanTitle(name.slice(marker.index + marker.length));
  const show = before || (group !== undefined ? cleanShowName(group) : '') || after || name;
  return { season: marker.season, episode: marker.episode, show, title: after || name };
}

/** Normalised identity of a show name (case, diacritics and punctuation ignored). */
export function showIdentity(show: string): string {
  const words = tokenizeSearchText(show);
  return words.length > 0 ? words.join(' ') : show.trim().toLowerCase();
}

const AUDIO_CONTAINERS: ReadonlySet<StreamContainer> = new Set(['mp3', 'aac', 'ogg', 'flac']);

/** What a group title says (undefined: nothing). Pure; cache the result per group string. */
export function classifyGroup(
  group: string | undefined,
  rules: M3uClassificationRules = DEFAULT_M3U_RULES,
): GroupKind | undefined {
  if (group === undefined) return undefined;
  const words = tokenizeSearchText(group);
  if (words.length === 0) return undefined;
  const live = new Set(rules.liveGroupWords);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (live.has(word)) return 'live';
    const next = words[i + 1];
    if (next !== undefined && live.has(`${word} ${next}`)) return 'live';
  }
  const noise = new Set(rules.groupNoiseWords);
  let significant = 0;
  for (let i = 0; i < words.length && significant < rules.groupLeadWords; i++) {
    const word = words[i] as string;
    const next = words[i + 1];
    const pair = next !== undefined ? rules.groupKeywords[`${word} ${next}`] : undefined;
    if (pair !== undefined) return pair;
    const single = rules.groupKeywords[word];
    if (single !== undefined) return single;
    if (word.length > 2 && !noise.has(word)) significant++;
  }
  return undefined;
}

/** What the classifier looks at (all already sanitised by the parser). */
export interface ClassifyInput {
  name: string;
  /** URL path (`URL.pathname`). */
  path: string;
  group?: string | undefined;
  container?: StreamContainer | undefined;
  /** `media="true"`. */
  media?: boolean | undefined;
  audioOnly?: boolean | undefined;
}

/** Which rule decided (tests, diagnostics). */
export type ClassifyReason =
  'url' | 'audio' | 'group' | 'media' | 'extension' | 'episode-marker' | 'default';

export interface Classification {
  type: ContentType;
  reason: ClassifyReason;
  /** Series entries with an episode marker: season, episode, show and title. */
  episode?: EpisodeInfo;
}

function urlKind(path: string): ContentType | undefined {
  const lower = path.toLowerCase();
  if (lower.includes('/movie/')) return 'movie';
  if (lower.includes('/series/')) return 'series';
  if (lower.includes('/live/')) return 'live';
  return undefined;
}

function resolveVod(
  kind: Exclude<GroupKind, 'live'>,
  input: ClassifyInput,
  reason: ClassifyReason,
): Classification {
  // A movie group needs a strong marker to become a series ("Rocky 2x10" stays a movie).
  const marker = kind === 'movie' ? strongEpisodeMarker(input.name) : episodeMarker(input.name);
  if (kind === 'movie' && marker === undefined) return { type: 'movie', reason };
  if (marker === undefined) return { type: kind === 'series' ? 'series' : 'movie', reason };
  return { type: 'series', reason, episode: episodeInfo(input.name, marker, input.group) };
}

/** Classifies one entry (computing its group decision; lists use {@link M3uClassifier}). */
export function classifyEntry(
  input: ClassifyInput,
  rules: M3uClassificationRules = DEFAULT_M3U_RULES,
): Classification {
  return decide(input, rules, classifyGroup(input.group, rules));
}

/** The rule chain, with the group decision already made. */
function decide(
  input: ClassifyInput,
  rules: M3uClassificationRules,
  groupKind: GroupKind | undefined,
): Classification {
  const byUrl = urlKind(input.path);
  if (byUrl === 'live') return { type: 'live', reason: 'url' };
  if (byUrl === 'movie') return { type: 'movie', reason: 'url' };
  if (byUrl === 'series') return resolveVod('series', input, 'url');
  if (input.audioOnly || (input.container !== undefined && AUDIO_CONTAINERS.has(input.container))) {
    return { type: 'live', reason: 'audio' };
  }
  if (groupKind === 'live') return { type: 'live', reason: 'group' };
  if (groupKind !== undefined) return resolveVod(groupKind, input, 'group');
  if (input.media === true) return resolveVod('vod', input, 'media');
  if (input.container !== undefined && rules.vodContainers.includes(input.container)) {
    return resolveVod('vod', input, 'extension');
  }
  const marker = strongEpisodeMarker(input.name);
  if (marker !== undefined) {
    return {
      type: 'series',
      reason: 'episode-marker',
      episode: episodeInfo(input.name, marker, input.group),
    };
  }
  return { type: 'live', reason: 'default' };
}

/** Per-list classifier: caches the group decision per distinct group string (O(1) per entry). */
export class M3uClassifier {
  private readonly groups = new Map<string, GroupKind | undefined>();

  constructor(readonly rules: M3uClassificationRules = DEFAULT_M3U_RULES) {}

  classify(input: ClassifyInput): Classification {
    let kind: GroupKind | undefined;
    if (input.group !== undefined) {
      if (this.groups.has(input.group)) kind = this.groups.get(input.group);
      else {
        kind = classifyGroup(input.group, this.rules);
        this.groups.set(input.group, kind);
      }
    }
    return decide(input, this.rules, kind);
  }
}
