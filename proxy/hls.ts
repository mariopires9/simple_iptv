// HLS playlist detection and rewriting (PRX-01).
//
// Only HLS playlists are rewritten: every URI line and every `URI="…"` attribute becomes an
// absolute proxy `g` URL, resolved against the final (post-redirect) playlist URL, so segments,
// keys and renditions on edge hosts also go through the proxy. IPTV M3U channel lists (`#EXTM3U`
// followed by `#EXTINF` entries) are not HLS and must pass byte-identical.

/** How many bytes of the body may be inspected before deciding. */
export const SNIFF_WINDOW = 64 * 1024;

const HLS_TAG =
  /^[ \t]*#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|PLAYLIST-TYPE|KEY|SESSION-KEY|MEDIA|MAP|I-FRAME-STREAM-INF|ENDLIST|DISCONTINUITY-SEQUENCE|INDEPENDENT-SEGMENTS|PART-INF|SERVER-CONTROL|PART|PRELOAD-HINT|RENDITION-REPORT|PROGRAM-DATE-TIME)(?=[:\s]|$)/m;

/** Tags whose `URI="…"` attribute points to a resource the player will fetch. */
const URI_TAGS = new Set([
  'EXT-X-KEY',
  'EXT-X-SESSION-KEY',
  'EXT-X-MAP',
  'EXT-X-MEDIA',
  'EXT-X-I-FRAME-STREAM-INF',
  'EXT-X-PART',
  'EXT-X-PRELOAD-HINT',
  'EXT-X-RENDITION-REPORT',
]);

export type SniffVerdict = 'hls' | 'not-hls' | 'undecided';

/**
 * Classifies the beginning of a body (latin1 text is enough: the markers are ASCII).
 * - not `#EXTM3U` after an optional BOM/whitespace → `not-hls` (decided on the first bytes)
 * - `#EXTM3U` and an HLS tag at the start of a line within the window → `hls`
 * - otherwise `undecided` until the window is full or the body ends (`complete`).
 */
export function sniffPlaylist(prefix: string, complete: boolean): SniffVerdict {
  const text = prefix.replace(/^(?:\u00ef\u00bb\u00bf|\ufeff)/, '').replace(/^\s+/, '');
  const marker = '#EXTM3U';
  if (text.length < marker.length) {
    if (!marker.startsWith(text)) return 'not-hls';
    return complete ? 'not-hls' : 'undecided';
  }
  if (!text.startsWith(marker)) return 'not-hls';
  const window = text.slice(0, SNIFF_WINDOW);
  if (HLS_TAG.test(window)) return 'hls';
  return complete || prefix.length >= SNIFF_WINDOW ? 'not-hls' : 'undecided';
}

/** Turns an absolute upstream URL into the proxy URL written into the playlist. */
export type UriRewriter = (absoluteUrl: string) => string;

/** Resolves `value` against `base` and rewrites it; non-http(s) URIs (skd:, data:) stay as-is. */
function rewriteUri(value: string, base: URL, rewrite: UriRewriter): string {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  if (scheme && !/^https?$/i.test(scheme[1] ?? '')) return value;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return value;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
  url.hash = '';
  return rewrite(url.href);
}

function rewriteLine(line: string, base: URL, rewrite: UriRewriter): string {
  const trimmed = line.trim();
  if (trimmed === '') return line;
  if (trimmed.startsWith('#')) {
    const tag = /^#([A-Z0-9-]+)/.exec(trimmed)?.[1];
    if (tag === undefined || !URI_TAGS.has(tag)) return line;
    return line.replace(
      /([:,][ \t]*URI=")([^"]*)(")/g,
      (_match, open: string, value: string, close: string) =>
        `${open}${rewriteUri(value, base, rewrite)}${close}`,
    );
  }
  const start = line.indexOf(trimmed);
  return `${line.slice(0, start)}${rewriteUri(trimmed, base, rewrite)}${line.slice(start + trimmed.length)}`;
}

/**
 * Rewrites an HLS playlist. Line endings (LF, CRLF, CR) and a leading BOM are preserved; tags
 * without URIs, comments and blank lines are untouched.
 */
export function rewritePlaylist(text: string, finalUrl: URL, rewrite: UriRewriter): string {
  const parts = text.split(/(\r\n|\n|\r)/);
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    let line = parts[i] ?? '';
    let bom = '';
    if (i === 0 && line.startsWith('\ufeff')) {
      bom = '\ufeff';
      line = line.slice(1);
    }
    out += bom + rewriteLine(line, finalUrl, rewrite) + (parts[i + 1] ?? '');
  }
  return out;
}
