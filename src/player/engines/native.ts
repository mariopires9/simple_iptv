// Native <video> engine (PLY-01): MP4/WebM/MOV/MKV everywhere, HLS on Safari/iOS.
import { mapMediaError } from '../errors';
import type { EngineDeps, PlayerEngine, StreamDescriptor } from '../types';
import { createErrorEmitter, requireVideo, resetMediaElement } from './shared';

export function createNativeEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const errors = createErrorEmitter();
  let video: HTMLVideoElement | undefined;
  let cleanup: (() => void) | undefined;
  let destroyed = false;

  return {
    id: 'native',

    attach(element) {
      video = element;
    },

    async load(stream: StreamDescriptor, startAt?: number) {
      if (destroyed) return;
      const el = requireVideo(video, 'native');
      // With native HLS the browser fetches the segments itself: only the playlist URL can be
      // rewritten here (a proxy has to rewrite the playlist contents).
      const url = rewriter.rewrite(stream.url, stream.container === 'hls' ? 'playlist' : 'stream');

      const onError = () =>
        errors.emit(mapMediaError(el.error?.code, { engine: 'native', url, pageProtocol }));
      const onMetadata = () => {
        if (startAt !== undefined && startAt > 0) el.currentTime = startAt;
      };
      el.addEventListener('error', onError);
      el.addEventListener('loadedmetadata', onMetadata, { once: true });
      cleanup = () => {
        el.removeEventListener('error', onError);
        el.removeEventListener('loadedmetadata', onMetadata);
      };
      el.src = url;
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup?.();
      cleanup = undefined;
      errors.clear();
      if (video) resetMediaElement(video);
      video = undefined;
    },

    on(_evt, cb) {
      return errors.on(cb);
    },
  };
}
