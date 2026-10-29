// Streaming M3U/M3U8 playlist parser (SRC-04, docs/RESEARCH.md §8). Runs inside the data worker.
//
// The parser is incremental: text is pushed in chunks of any size (`write`) and complete lines are
// processed as soon as they are seen, so a playlist is never held in memory as a whole — only the
// current partial line (capped at MAX_LINE_LENGTH) plus whatever the caller keeps from the emitted
// entries. A line split across chunks, a UTF-8 BOM, CRLF / CR / LF line endings and blank lines are
// all handled; the output does not depend on how the input is chunked (property-tested).
//
// Lists are untrusted input (docs/SECURITY.md §3):
// - Stream URLs go through `parseExternalUrl(…, 'stream')`: only absolute http(s) URLs without
//   userinfo are kept; anything else is skipped and counted with a reason.
// - Names, groups and attribute values are plain text: control and bidi-override characters are
//   removed, whitespace collapsed and the length capped.
// - Attributes are kept in a Map (never a plain object), so keys such as `__proto__` are inert.
// - A line longer than MAX_LINE_LENGTH is dropped without being buffered further; when it was an
//   `#EXTINF` line its entry is skipped (`line-too-long`).
//
// Grammar (tolerant):
//   #EXTM3U [url-tvg="a,b"] [x-tvg-url="c"] …          header (may repeat; attributes merged)
//   #EXTINF:<duration> key="v" key='v' key=v …,<name>     starts an entry
//   #EXTGRP:<group>                                      group, used when there is no group-title
//   #EXTVLCOPT:<key>=<value> · #KODIPROP:<key>=<value>  options of the next entry
//   <url>[|Header=Value&…]                              ends the entry (Kodi header suffix allowed)
// Option lines (EXTGRP/EXTVLCOPT/KODIPROP) attach to the entry whose URL comes next, wherever they
// appear before that URL. Other `#` lines are ignored. A URL without a preceding `#EXTINF` is
// skipped (`no-extinf`); an `#EXTINF` without a URL is skipped (`missing-url`).
import type { ContentType, RequiredHeader, StreamContainer } from '@/core/db';
import { parseExternalUrl } from '@/core/net';
import {
  DEFAULT_M3U_RULES,
  M3uClassifier,
  type EpisodeInfo,
  type M3uClassificationRules,
} from './classify';

/** Lines longer than this (in UTF-16 code units, ~64 KB of ASCII) are dropped. */
export const MAX_LINE_LENGTH = 64 * 1024;
/** Display texts (names, groups) are capped at this many code points (SECURITY.md §3). */
export const MAX_NAME_LENGTH = 512;
/** Other attribute values are capped at this many code points. */
export const MAX_ATTRIBUTE_LENGTH = 2048;
/** At most this many `#EXTVLCOPT` / `#KODIPROP` lines are kept per entry (the rest are ignored). */
export const MAX_OPTIONS_PER_ENTRY = 32;

export interface M3uAttributes {
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  /** `tvg-chno` (or `channel-number`), as written. */
  tvgChno?: string;
  catchup?: string;
  catchupDays?: string;
  catchupSource?: string;
  timeshift?: string;
  /** `radio="true"`. */
  radio?: boolean;
  /** `media="true"` (Kodi IPTV Simple's on-demand marker, VOD-04). */
  media?: boolean;
}

export interface M3uOption {
  /** Lower-case key. */
  key: string;
  value: string;
}

export interface M3uEntry {
  /** Display name (sanitized, never empty). */
  name: string;
  /** Normalized absolute http(s) URL, without any Kodi `|header` suffix. */
  url: string;
  /** `#EXTINF` duration when numeric (`-1` for live). */
  duration?: number;
  attrs: M3uAttributes;
  /** Group from `#EXTGRP` (sanitized). */
  extGrp?: string;
  /** Effective group: `group-title`, else `#EXTGRP`; undefined → "Uncategorized" (AC9). */
  group?: string;
  vlcOpts: M3uOption[];
  kodiProps: M3uOption[];
  /** Live / movie / series (VOD-04 rules, `./classify.ts`); uncertain entries are live. */
  type: ContentType;
  /** Series entries with an episode marker: show, season, episode and title (VOD-04 AC3). */
  episode?: EpisodeInfo;
  // --- AC8 flags ---
  drm: boolean;
  requiredHeaders: RequiredHeader[];
  container?: StreamContainer;
  audioOnly: boolean;
}

export interface M3uHeader {
  /** EPG URLs from `url-tvg` / `x-tvg-url` (comma-separated values split), valid http(s) only. */
  epgUrls: string[];
}

export type M3uSkipReason =
  /** Not a URL, or a relative URL. */
  | 'invalid-url'
  /** Not http(s): `javascript:`, `data:`, `file:`, `rtmp:`, `udp:`… */
  | 'unsupported-scheme'
  /** URL with userinfo (`user:pass@host`): browsers refuse to fetch it (SECURITY.md §3). */
  | 'credentials-url'
  /** `#EXTINF` not followed by a URL. */
  | 'missing-url'
  /** URL line without a preceding `#EXTINF`. */
  | 'no-extinf'
  /** The `#EXTINF` or URL line exceeded MAX_LINE_LENGTH. */
  | 'line-too-long'
  /** No usable display name could be derived. */
  | 'missing-name';

export const M3U_SKIP_REASONS: readonly M3uSkipReason[] = [
  'invalid-url',
  'unsupported-scheme',
  'credentials-url',
  'missing-url',
  'no-extinf',
  'line-too-long',
  'missing-name',
];

export interface M3uParseStats {
  /** Entries emitted. */
  entries: number;
  /** Entries (or orphan URLs) skipped, total and by reason. */
  skipped: number;
  skippedByReason: Record<M3uSkipReason, number>;
  /** Lines seen (including blank and dropped ones). */
  lines: number;
  /** Lines dropped for exceeding MAX_LINE_LENGTH. */
  longLines: number;
}

/**
 * What the first non-blank line was: `undefined` until one has been seen. `extinf`: a list without
 * the `#EXTM3U` header that starts directly with an entry (accepted, SRC-04 AC4).
 */
export type M3uFirstLine = 'header' | 'extinf' | 'other' | undefined;

function classifyFirstLine(line: string): Exclude<M3uFirstLine, undefined> {
  if (startsWithTag(line, '#EXTM3U')) return 'header';
  return startsWithTag(line, '#EXTINF') ? 'extinf' : 'other';
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const WHITESPACE = /\s+/g;
const NEWLINE = /[\r\n]/g;
const DURATION = /^-?\d+(?:\.\d+)?/;

/** Removes control/bidi-override characters, collapses whitespace, trims and caps code points. */
export function cleanText(value: string, max: number): string {
  const text = value.replace(CONTROL_CHARS, ' ').replace(WHITESPACE, ' ').trim();
  if (text.length <= max) return text;
  // Cut by code points, never inside a surrogate pair.
  return Array.from(text).slice(0, max).join('').trim();
}

const isSpace = (c: string) => c === ' ' || c === '\t';

interface ParsedTag {
  duration?: number;
  attrs: Map<string, string>;
  /** Text after the first comma outside quotes (raw). */
  name: string;
}

/**
 * Parses `<duration> key="v" key='v' key=v …,name` (the text after `#EXTINF:`), or the header
 * attributes (text after `#EXTM3U`). Commas inside quoted values do not end the attributes; spaces
 * around `=` are allowed; keys are lower-cased; the first occurrence of a key wins. Without any
 * comma, leftover bare words become the name (tolerance for `… group-title="x" Name`).
 */
export function parseTagBody(body: string, withDuration: boolean): ParsedTag {
  const attrs = new Map<string, string>();
  const n = body.length;
  let i = 0;
  while (i < n && isSpace(body[i] as string)) i++;
  let duration: number | undefined;
  if (withDuration) {
    const match = DURATION.exec(body.slice(i, i + 32));
    if (match) {
      duration = Number(match[0]);
      i += match[0].length;
    }
  }
  const bare: string[] = [];
  while (i < n) {
    const c = body[i] as string;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === ',') return { duration, attrs, name: body.slice(i + 1) };
    const start = i;
    while (i < n) {
      const k = body[i] as string;
      if (isSpace(k) || k === '=' || k === ',' || k === '"' || k === "'") break;
      i++;
    }
    const key = body.slice(start, i);
    let j = i;
    while (j < n && isSpace(body[j] as string)) j++;
    if (key !== '' && body[j] === '=') {
      j++;
      while (j < n && isSpace(body[j] as string)) j++;
      const quote = body[j];
      let value: string;
      if (quote === '"' || quote === "'") {
        const close = body.indexOf(quote, j + 1);
        if (close < 0) {
          // Unterminated quote: the value runs to the end; take the name after the last comma.
          const comma = body.lastIndexOf(',');
          const name = comma > j ? body.slice(comma + 1) : '';
          value = body.slice(j + 1, comma > j ? comma : n);
          const lower = key.toLowerCase();
          if (!attrs.has(lower)) attrs.set(lower, value);
          return { duration, attrs, name };
        }
        value = body.slice(j + 1, close);
        i = close + 1;
      } else {
        const valueStart = j;
        while (j < n && !isSpace(body[j] as string) && body[j] !== ',') j++;
        value = body.slice(valueStart, j);
        i = j;
      }
      const lower = key.toLowerCase();
      if (!attrs.has(lower)) attrs.set(lower, value);
    } else {
      if (key !== '') bare.push(key);
      // A stray quote or `=`: step over it.
      if (i === start) i++;
    }
  }
  return { duration, attrs, name: bare.join(' ') };
}

const EXTENSION_CONTAINERS: Record<string, StreamContainer> = {
  m3u8: 'hls',
  m3u: 'hls',
  ts: 'ts',
  mts: 'ts',
  m2ts: 'ts',
  mp4: 'mp4',
  m4v: 'mp4',
  mkv: 'mkv',
  webm: 'webm',
  flv: 'flv',
  mov: 'mov',
  avi: 'avi',
  mpd: 'dash',
  mp3: 'mp3',
  aac: 'aac',
  m4a: 'aac',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'ogg',
  flac: 'flac',
};

const AUDIO_CONTAINERS: ReadonlySet<StreamContainer> = new Set(['mp3', 'aac', 'ogg', 'flac']);

/** Container from the last path segment's extension (`.mpd` → `dash`); undefined if unknown. */
export function containerFromUrl(url: URL): StreamContainer | undefined {
  const segment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  const dot = segment.lastIndexOf('.');
  if (dot < 0) return undefined;
  return EXTENSION_CONTAINERS[segment.slice(dot + 1).toLowerCase()];
}

/**
 * The URL rule alone (SRC-04 AC7): `/movie/` → movie, `/series/` → series, else live. Entries are
 * classified with the full VOD-04 rule chain (`./classify.ts`); kept for callers of the URL rule.
 */
export function classifyUrl(url: URL): ContentType {
  const path = url.pathname.toLowerCase();
  if (path.includes('/movie/')) return 'movie';
  if (path.includes('/series/')) return 'series';
  return 'live';
}

const HEADER_NAMES: Record<string, RequiredHeader> = {
  'user-agent': 'user-agent',
  'http-user-agent': 'user-agent',
  referer: 'referer',
  referrer: 'referer',
  'http-referrer': 'referer',
  'http-referer': 'referer',
  origin: 'origin',
  'http-origin': 'origin',
};

/** Header names in a Kodi-style `Name=Value&Name2=Value2` list. */
function headersInList(list: string, into: Set<RequiredHeader>): void {
  for (const part of list.split('&')) {
    const eq = part.indexOf('=');
    const name = HEADER_NAMES[(eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase()];
    if (name !== undefined) into.add(name);
  }
}

function splitOption(text: string): M3uOption | undefined {
  const eq = text.indexOf('=');
  if (eq <= 0) return undefined;
  return {
    key: text.slice(0, eq).trim().toLowerCase(),
    value: cleanText(text.slice(eq + 1), MAX_ATTRIBUTE_LENGTH),
  };
}

function textAttr(attrs: Map<string, string>, max: number, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = attrs.get(key);
    if (raw === undefined) continue;
    const value = cleanText(raw, max);
    if (value !== '') return value;
  }
  return undefined;
}

function toAttributes(raw: Map<string, string>): M3uAttributes {
  const attrs: M3uAttributes = {};
  const set = <K extends keyof M3uAttributes>(key: K, value: M3uAttributes[K] | undefined) => {
    if (value !== undefined) attrs[key] = value;
  };
  set('tvgId', textAttr(raw, MAX_ATTRIBUTE_LENGTH, 'tvg-id'));
  set('tvgName', textAttr(raw, MAX_NAME_LENGTH, 'tvg-name'));
  set('tvgLogo', textAttr(raw, MAX_ATTRIBUTE_LENGTH, 'tvg-logo', 'logo'));
  set('groupTitle', textAttr(raw, MAX_NAME_LENGTH, 'group-title'));
  set('tvgChno', textAttr(raw, 16, 'tvg-chno', 'channel-number', 'tvg-num'));
  set('catchup', textAttr(raw, 32, 'catchup', 'catchup-type'));
  set('catchupDays', textAttr(raw, 16, 'catchup-days'));
  set('catchupSource', textAttr(raw, MAX_ATTRIBUTE_LENGTH, 'catchup-source'));
  set('timeshift', textAttr(raw, 16, 'timeshift'));
  if (raw.get('radio')?.trim().toLowerCase() === 'true') attrs.radio = true;
  if (raw.get('media')?.trim().toLowerCase() === 'true') attrs.media = true;
  return attrs;
}

interface PendingInfo {
  duration?: number;
  attrs: M3uAttributes;
  name: string;
}

/** Options collected for the next URL. */
interface PendingOptions {
  extGrp?: string;
  vlcOpts: M3uOption[];
  kodiProps: M3uOption[];
}

const emptyOptions = (): PendingOptions => ({ vlcOpts: [], kodiProps: [] });

const startsWithTag = (line: string, tag: string) =>
  line.length >= tag.length && line.slice(0, tag.length).toUpperCase() === tag;

/** Last path segment without its extension, as a name of last resort. */
function nameFromUrl(url: URL): string {
  const segment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment.
  }
  const dot = decoded.lastIndexOf('.');
  return cleanText(dot > 0 ? decoded.slice(0, dot) : decoded, MAX_NAME_LENGTH);
}

export interface M3uParserOptions {
  /** Called for every valid entry, in list order. */
  onEntry: (entry: M3uEntry) => void;
  /** Live/movie/series classification rules (VOD-04); defaults to {@link DEFAULT_M3U_RULES}. */
  rules?: M3uClassificationRules;
}

/**
 * Incremental parser. Feed text with {@link write} (chunks of any size, already decoded), then call
 * {@link end}. Entries are delivered synchronously through `onEntry`.
 */
export class M3uParser {
  readonly header: M3uHeader = { epgUrls: [] };
  readonly stats: M3uParseStats = {
    entries: 0,
    skipped: 0,
    skippedByReason: Object.fromEntries(M3U_SKIP_REASONS.map((r) => [r, 0])) as Record<
      M3uSkipReason,
      number
    >,
    lines: 0,
    longLines: 0,
  };
  firstLine: M3uFirstLine = undefined;

  private readonly onEntry: (entry: M3uEntry) => void;
  private partial = '';
  /** Inside a line that exceeded the cap: drop text until the next line break. */
  private discarding = false;
  private pending: PendingInfo | undefined;
  /** The `#EXTINF` of the next entry was dropped (too long): its URL is skipped too. */
  private pendingDropped = false;
  private options: PendingOptions = emptyOptions();
  private ended = false;
  private readonly epgSeen = new Set<string>();
  private readonly classifier: M3uClassifier;

  constructor({ onEntry, rules = DEFAULT_M3U_RULES }: M3uParserOptions) {
    this.onEntry = onEntry;
    this.classifier = new M3uClassifier(rules);
  }

  /** Pushes a chunk of decoded text. */
  write(chunk: string): void {
    if (this.ended) throw new Error('M3uParser: write after end');
    let pos = 0;
    const n = chunk.length;
    while (pos < n) {
      NEWLINE.lastIndex = pos;
      const match = NEWLINE.exec(chunk);
      const end = match ? match.index : n;
      if (this.discarding) {
        if (match) this.discarding = false;
      } else if (this.partial.length + (end - pos) > MAX_LINE_LENGTH) {
        // Enough of the line's start to recognise its tag, independent of how it was chunked.
        this.dropLongLine((this.partial.slice(0, 64) + chunk.slice(pos, pos + 64)).slice(0, 64));
        this.partial = '';
        this.discarding = !match;
      } else if (match) {
        const line = this.partial + chunk.slice(pos, end);
        this.partial = '';
        this.line(line);
      } else {
        this.partial += chunk.slice(pos, end);
      }
      if (!match) break;
      pos = end + 1;
    }
  }

  /** Flushes the last line and closes the parser; returns the final stats. */
  end(): M3uParseStats {
    if (this.ended) return this.stats;
    if (this.partial !== '') this.line(this.partial);
    this.partial = '';
    this.discarding = false;
    if (this.pending) this.skip('missing-url');
    if (this.pendingDropped) this.skip('line-too-long');
    this.pending = undefined;
    this.pendingDropped = false;
    this.ended = true;
    return this.stats;
  }

  private skip(reason: M3uSkipReason): void {
    this.stats.skipped++;
    this.stats.skippedByReason[reason]++;
  }

  private dropLongLine(prefix: string): void {
    this.stats.lines++;
    this.stats.longLines++;
    const head = prefix.replace(/^\uFEFF/, '').trimStart();
    if (this.firstLine === undefined) {
      this.firstLine = classifyFirstLine(head);
    }
    if (startsWithTag(head, '#EXTINF')) {
      if (this.pending) this.skip('missing-url');
      if (this.pendingDropped) this.skip('line-too-long');
      this.pending = undefined;
      this.pendingDropped = true;
    } else if (!head.startsWith('#')) {
      // An over-long URL line ends the current entry.
      if (this.pending || this.pendingDropped) this.skip('line-too-long');
      else this.skip('no-extinf');
      this.pending = undefined;
      this.pendingDropped = false;
      this.options = emptyOptions();
    }
  }

  private line(raw: string): void {
    this.stats.lines++;
    let line = raw.trim();
    if (this.firstLine === undefined) line = line.replace(/^\uFEFF/, '').trim();
    if (line === '') return;
    if (this.firstLine === undefined) {
      this.firstLine = classifyFirstLine(line);
    }
    if (line.startsWith('#')) {
      this.tag(line);
      return;
    }
    this.url(line);
  }

  private tag(line: string): void {
    if (startsWithTag(line, '#EXTINF')) {
      if (this.pending) this.skip('missing-url');
      if (this.pendingDropped) this.skip('line-too-long');
      this.pendingDropped = false;
      const body = line.slice('#EXTINF'.length).replace(/^:/, '');
      const parsed = parseTagBody(body, true);
      const info: PendingInfo = { attrs: toAttributes(parsed.attrs), name: parsed.name };
      if (parsed.duration !== undefined) info.duration = parsed.duration;
      this.pending = info;
    } else if (startsWithTag(line, '#EXTM3U')) {
      this.headerLine(line.slice('#EXTM3U'.length));
    } else if (startsWithTag(line, '#EXTGRP:')) {
      const group = cleanText(line.slice('#EXTGRP:'.length), MAX_NAME_LENGTH);
      if (group !== '') this.options.extGrp = group;
    } else if (startsWithTag(line, '#EXTVLCOPT:')) {
      const option = splitOption(line.slice('#EXTVLCOPT:'.length));
      if (option && this.options.vlcOpts.length < MAX_OPTIONS_PER_ENTRY) {
        this.options.vlcOpts.push(option);
      }
    } else if (startsWithTag(line, '#KODIPROP:')) {
      const option = splitOption(line.slice('#KODIPROP:'.length));
      if (option && this.options.kodiProps.length < MAX_OPTIONS_PER_ENTRY) {
        this.options.kodiProps.push(option);
      }
    }
    // Any other `#…` line is a comment or an unknown tag: ignored.
  }

  private headerLine(body: string): void {
    const { attrs } = parseTagBody(body, false);
    for (const key of ['url-tvg', 'x-tvg-url']) {
      const value = attrs.get(key);
      if (value === undefined) continue;
      for (const part of value.split(',')) {
        const parsed = parseExternalUrl(part, 'epg');
        if (!parsed.ok || this.epgSeen.has(parsed.url.href)) continue;
        this.epgSeen.add(parsed.url.href);
        this.header.epgUrls.push(parsed.url.href);
      }
    }
  }

  private url(line: string): void {
    const info = this.pending;
    const dropped = this.pendingDropped;
    const options = this.options;
    this.pending = undefined;
    this.pendingDropped = false;
    this.options = emptyOptions();
    if (dropped) {
      this.skip('line-too-long');
      return;
    }
    if (!info) {
      this.skip('no-extinf');
      return;
    }
    // Kodi syntax: `url|User-Agent=…&Referer=…`.
    const pipe = line.indexOf('|');
    const href = pipe >= 0 ? line.slice(0, pipe) : line;
    const parsed = parseExternalUrl(href, 'stream');
    if (!parsed.ok) {
      this.skip(
        parsed.reason === 'scheme'
          ? 'unsupported-scheme'
          : parsed.reason === 'credentials'
            ? 'credentials-url'
            : 'invalid-url',
      );
      return;
    }
    const url = parsed.url;
    const name =
      cleanText(info.name, MAX_NAME_LENGTH) ||
      info.attrs.tvgName ||
      (info.attrs.tvgId !== undefined ? cleanText(info.attrs.tvgId, MAX_NAME_LENGTH) : '') ||
      nameFromUrl(url);
    if (name === '') {
      this.skip('missing-name');
      return;
    }

    const headers = new Set<RequiredHeader>();
    if (pipe >= 0) headersInList(line.slice(pipe + 1), headers);
    for (const { key } of options.vlcOpts) {
      const header = HEADER_NAMES[key];
      if (header !== undefined && key.startsWith('http-')) headers.add(header);
    }
    let drm = false;
    let container = containerFromUrl(url);
    for (const { key, value } of options.kodiProps) {
      if (/^inputstream\.adaptive\.(license_|drm)/.test(key)) drm = true;
      else if (key === 'inputstream.adaptive.manifest_type') {
        const type = value.toLowerCase();
        if (type === 'mpd' || type === 'dash') container = 'dash';
        else if (type === 'hls' && container === undefined) container = 'hls';
      } else if (/^inputstream\.adaptive\.(stream|manifest)_headers$/.test(key)) {
        headersInList(value, headers);
      }
    }

    const audioOnly =
      info.attrs.radio === true || (container !== undefined && AUDIO_CONTAINERS.has(container));
    const group = info.attrs.groupTitle ?? options.extGrp;
    const classification = this.classifier.classify({
      name,
      path: url.pathname,
      group,
      container,
      media: info.attrs.media,
      audioOnly,
    });
    const entry: M3uEntry = {
      name,
      url: url.href,
      attrs: info.attrs,
      vlcOpts: options.vlcOpts,
      kodiProps: options.kodiProps,
      type: classification.type,
      drm,
      requiredHeaders: [...headers],
      audioOnly,
    };
    if (classification.episode !== undefined) entry.episode = classification.episode;
    if (info.duration !== undefined) entry.duration = info.duration;
    if (options.extGrp !== undefined) entry.extGrp = options.extGrp;
    if (group !== undefined) entry.group = group;
    if (container !== undefined) entry.container = container;
    this.stats.entries++;
    this.onEntry(entry);
  }
}

export interface ParseStreamOptions {
  /** Called after each chunk with the cumulative number of bytes read. */
  onBytes?: (bytes: number) => void;
  /**
   * Called after each chunk has been parsed; return `false` to stop reading (the stream is
   * cancelled and the function resolves with what was parsed so far).
   */
  onChunk?: () => boolean | void;
  /** Aborting cancels the underlying reader and rejects with the signal's reason. */
  signal?: AbortSignal;
}

/**
 * Decodes a UTF-8 byte stream chunk by chunk (BOM stripped by TextDecoder) and feeds `parser`.
 * Returns `true` when the stream was read to the end (and the parser ended), `false` if `onChunk`
 * stopped it. Errors from the stream propagate (the reader is released).
 */
export async function feedM3uStream(
  stream: ReadableStream<Uint8Array>,
  parser: M3uParser,
  options: ParseStreamOptions = {},
): Promise<boolean> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  const { signal } = options;
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  let bytes = 0;
  try {
    if (signal?.aborted) throw signal.reason;
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      if (done) break;
      bytes += value.byteLength;
      parser.write(decoder.decode(value, { stream: true }));
      options.onBytes?.(bytes);
      if (options.onChunk?.() === false) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
    }
    parser.write(decoder.decode());
    parser.end();
    return true;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export interface ParsedPlaylist {
  header: M3uHeader;
  entries: M3uEntry[];
  stats: M3uParseStats;
  firstLine: M3uFirstLine;
}

/** Parses a whole playlist held in a string (tests, small inputs). */
export function parseM3uText(text: string): ParsedPlaylist {
  const entries: M3uEntry[] = [];
  const parser = new M3uParser({ onEntry: (e) => entries.push(e) });
  parser.write(text);
  const stats = parser.end();
  return { header: parser.header, entries, stats, firstLine: parser.firstLine };
}
