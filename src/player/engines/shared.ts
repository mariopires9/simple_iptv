// Helpers shared by the engines (PLY-01).
import type { EngineEvents, MediaTrack, StreamDescriptor } from '../types';

export interface EngineEmitter {
  on<K extends keyof EngineEvents>(evt: K, cb: (payload: EngineEvents[K]) => void): () => void;
  emit<K extends keyof EngineEvents>(evt: K, payload: EngineEvents[K]): void;
  clear(): void;
}

export function createEngineEmitter(): EngineEmitter {
  type AnyListener = (payload: never) => void;
  const listeners: Record<keyof EngineEvents, Set<AnyListener>> = {
    error: new Set(),
    notice: new Set(),
    tracks: new Set(),
  };
  return {
    on(evt, cb) {
      listeners[evt].add(cb);
      return () => {
        listeners[evt].delete(cb);
      };
    },
    emit(evt, payload) {
      for (const cb of [...listeners[evt]]) (cb as (p: typeof payload) => void)(payload);
    },
    clear() {
      listeners.error.clear();
      listeners.notice.clear();
      listeners.tracks.clear();
    },
  };
}

/** Whether `time` lies inside one of the element's seekable ranges. */
export function isSeekable(video: HTMLVideoElement, time: number): boolean {
  const ranges = video.seekable as TimeRanges | undefined;
  if (!ranges) return false;
  for (let i = 0; i < ranges.length; i++) {
    if (time >= ranges.start(i) && time <= ranges.end(i)) return true;
  }
  return false;
}

/** VOD resume position, or undefined (live streams always start at the live edge). */
export function resumePosition(stream: StreamDescriptor, startAt: number | undefined) {
  return stream.kind === 'vod' && startAt !== undefined && startAt > 0 ? startAt : undefined;
}

/**
 * Seeks to `startAt` once metadata is loaded if the element can seek there; otherwise emits a
 * `resume-unsupported` notice. `seek` defaults to setting `currentTime`. Returns the cleanup.
 */
export function seekWhenReady(
  video: HTMLVideoElement,
  startAt: number,
  emitter: EngineEmitter,
  seek: (time: number) => void = (time) => {
    video.currentTime = time;
  },
): () => void {
  const onMetadata = () => {
    if (isSeekable(video, startAt)) seek(startAt);
    else emitter.emit('notice', { type: 'resume-unsupported', startAt });
  };
  video.addEventListener('loadedmetadata', onMetadata, { once: true });
  return () => video.removeEventListener('loadedmetadata', onMetadata);
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

const MAX_TRACK_LABEL = 80;
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/**
 * A track from what the stream declares (PLY-05): the name is trimmed and capped, a language
 * that is not a plausible BCP 47 / ISO 639 tag is dropped. Playlist text is untrusted.
 */
export function toMediaTrack(id: string, label: unknown, language: unknown): MediaTrack {
  const name = typeof label === 'string' ? label.trim().slice(0, MAX_TRACK_LABEL) : '';
  const lang = typeof language === 'string' ? language.trim() : '';
  return { id, label: name, ...(LANGUAGE_TAG.test(lang) ? { language: lang } : {}) };
}
