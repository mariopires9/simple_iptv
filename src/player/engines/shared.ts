// Helpers shared by the engines (PLY-01).
import type { PlaybackError } from '../types';

export interface ErrorEmitter {
  on(cb: (e: PlaybackError) => void): () => void;
  emit(e: PlaybackError): void;
  clear(): void;
}

export function createErrorEmitter(): ErrorEmitter {
  const listeners = new Set<(e: PlaybackError) => void>();
  return {
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(e) {
      for (const cb of [...listeners]) cb(e);
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * Empties the element so the browser releases the previous source and its decoder:
 * `srcObject` (ManagedMediaSource is attached that way), a leftover `blob:` object URL is revoked
 * as a safety net (the libraries revoke their own; revoking twice is harmless), then
 * `removeAttribute('src')` + `load()` as the HTML spec recommends.
 */
export function resetMediaElement(video: HTMLVideoElement): void {
  if (video.srcObject) video.srcObject = null;
  const src = video.getAttribute('src');
  if (src !== null && src.startsWith('blob:')) URL.revokeObjectURL(src);
  video.removeAttribute('src');
  video.load();
}

/** Throws if no element was attached. */
export function requireVideo(
  video: HTMLVideoElement | undefined,
  engine: string,
): HTMLVideoElement {
  if (!video) throw new Error(`${engine} engine: attach() must be called before load()`);
  return video;
}
