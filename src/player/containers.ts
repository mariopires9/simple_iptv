// File extensions and declared container names → player containers (TEC-02). Shared by the
// features that turn catalogue entries into `StreamDescriptor`s (Live, Movies, Series).
//
// Lives in the player module because it maps onto the player's own `StreamContainer` vocabulary
// (core cannot import player types). The catalogue vocabulary written by the M3U provider
// (`@/core/db` `StreamContainer`: `mp3`, `aac`, `ogg`, `flac`, `dash`…) is one of the inputs.
import { declaredMediaContainer, mediaContainerOfExtension, type MediaContainer } from '@/core/net';
import type { StreamContainer } from './types';

/** A player container, or DASH (never played: no DRM circumvention, SECURITY.md §8). */
export type ContainerOrDash = StreamContainer | 'dash';

/**
 * The container that plays audio-only files (radio, audio VOD). The player has no audio
 * container kinds: the browser's own element plays them, which is what `mp4` selects (native
 * engine, no MSE).
 */
export const NATIVE_AUDIO_CONTAINER: StreamContainer = 'mp4';

/** The shared recognition (`@/core/net`, also behind the catalogue's "Protected" mark, UX-07). */
function toPlayer(container: MediaContainer | undefined): ContainerOrDash | undefined {
  return container === 'audio' ? NATIVE_AUDIO_CONTAINER : container;
}

/** Container of a file extension (`mkv`, `M3U8`, without the dot), if recognised. */
export function containerOfExtension(ext: string | undefined): ContainerOrDash | undefined {
  return toPlayer(mediaContainerOfExtension(ext));
}

/**
 * `container` as declared by a catalogue entry — `hls`, `dash`, any file extension, or an audio
 * container (`mp3`, `aac`, `ogg`, `flac`… → native audio) — if recognisable. Read defensively:
 * any non-string is "not declared".
 */
export function declaredContainer(value: unknown): ContainerOrDash | undefined {
  return toPlayer(declaredMediaContainer(value));
}
