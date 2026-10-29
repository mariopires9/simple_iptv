// File extensions and declared container names → player containers (TEC-02). Shared by the
// features that turn catalogue entries into `StreamDescriptor`s (Live, Movies, Series).
//
// Lives in the player module because it maps onto the player's own `StreamContainer` vocabulary
// (core cannot import player types). The catalogue vocabulary written by the M3U provider
// (`@/core/db` `StreamContainer`: `mp3`, `aac`, `ogg`, `flac`, `dash`…) is one of the inputs.
import type { StreamContainer } from './types';

/** A player container, or DASH (never played: no DRM circumvention, SECURITY.md §8). */
export type ContainerOrDash = StreamContainer | 'dash';

/**
 * The container that plays audio-only files (radio, audio VOD). The player has no audio
 * container kinds: the browser's own element plays them, which is what `mp4` selects (native
 * engine, no MSE).
 */
export const NATIVE_AUDIO_CONTAINER: StreamContainer = 'mp4';

const AUDIO_EXTENSIONS = ['mp3', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav'] as const;

const EXTENSION_CONTAINERS: Readonly<Record<string, ContainerOrDash>> = {
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
  ...Object.fromEntries(AUDIO_EXTENSIONS.map((ext) => [ext, NATIVE_AUDIO_CONTAINER])),
};

/** Container of a file extension (`mkv`, `M3U8`, without the dot), if recognised. */
export function containerOfExtension(ext: string | undefined): ContainerOrDash | undefined {
  if (ext === undefined) return undefined;
  const key = ext.toLowerCase();
  // Own keys only: `constructor`, `toString`… are not extensions.
  return Object.hasOwn(EXTENSION_CONTAINERS, key) ? EXTENSION_CONTAINERS[key] : undefined;
}

/**
 * `container` as declared by a catalogue entry — `hls`, `dash`, any file extension, or an audio
 * container (`mp3`, `aac`, `ogg`, `flac`… → native audio) — if recognisable. Read defensively:
 * any non-string is "not declared".
 */
export function declaredContainer(value: unknown): ContainerOrDash | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'hls' || v === 'dash') return v;
  return containerOfExtension(v);
}
