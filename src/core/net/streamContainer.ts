// Stream container from a declared name or a URL path's extension (TEC-02; moved here by UX-07 so
// the catalogue's "protected content" mark and the player's refusal use one rule). The player maps
// these onto its own `StreamContainer` vocabulary (`src/player/containers.ts`); core/db's
// `isProtectedStream` asks `isDashStream`.

/** Media containers recognised from names and extensions; `audio` = an audio-only file. */
export type MediaContainer =
  'hls' | 'ts' | 'mp4' | 'mkv' | 'webm' | 'mov' | 'flv' | 'avi' | 'dash' | 'audio';

const AUDIO_EXTENSIONS = ['mp3', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav'] as const;

const EXTENSION_CONTAINERS: Readonly<Record<string, MediaContainer>> = {
  m3u8: 'hls',
  m3u: 'hls',
  ts: 'ts',
  mpegts: 'ts',
  mts: 'ts',
  m2ts: 'ts',
  mp4: 'mp4',
  m4v: 'mp4',
  mkv: 'mkv',
  webm: 'webm',
  mov: 'mov',
  flv: 'flv',
  avi: 'avi',
  mpd: 'dash',
  ...Object.fromEntries(AUDIO_EXTENSIONS.map((ext) => [ext, 'audio' as const])),
};

/** Container of a file extension (`mkv`, `M3U8`, without the dot), if recognised. */
export function mediaContainerOfExtension(ext: string | undefined): MediaContainer | undefined {
  if (ext === undefined) return undefined;
  const key = ext.toLowerCase();
  // Own keys only: `constructor`, `toString`… are not extensions.
  return Object.hasOwn(EXTENSION_CONTAINERS, key) ? EXTENSION_CONTAINERS[key] : undefined;
}

/**
 * `container` as declared by a catalogue entry — `hls`, `dash`, any file extension or audio
 * container — if recognisable. Read defensively: any non-string is "not declared".
 */
export function declaredMediaContainer(value: unknown): MediaContainer | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'hls' || v === 'dash') return v;
  return mediaContainerOfExtension(v);
}

/** Lower-case extension at the end of a URL path (`/a/7.MKV` → `mkv`), if any. */
export function pathExtension(pathname: string): string | undefined {
  return /\.([a-z0-9]{1,6})$/i.exec(pathname)?.[1]?.toLowerCase();
}

/**
 * The stream is DASH: its declared container when recognised, else the extension of its URL's
 * path (query and fragment ignored: `play.php?src=feed.mpd` is not DASH). An unrecognised declared
 * container falls back to the URL, as the player does.
 */
export function isDashStream(stream: { container?: unknown; streamUrl?: unknown }): boolean {
  const declared = declaredMediaContainer(stream.container);
  if (declared !== undefined) return declared === 'dash';
  if (typeof stream.streamUrl !== 'string') return false;
  let pathname: string;
  try {
    pathname = new URL(stream.streamUrl).pathname;
  } catch {
    return false;
  }
  return mediaContainerOfExtension(pathExtension(pathname)) === 'dash';
}
