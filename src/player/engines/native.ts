// Native <video> engine (PLY-01): MP4/WebM/MOV/MKV everywhere, HLS on Safari/iOS.
import { mapMediaError } from '../errors';
import type { EngineDeps, PlayerEngine, StreamDescriptor } from '../types';
import {
  createEngineEmitter,
  requireVideo,
  resetMediaElement,
  resumePosition,
  seekWhenReady,
} from './shared';

export function createNativeEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const events = createEngineEmitter();
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
        events.emit(
          'error',
          mapMediaError(el.error?.code, { engine: 'native', url, pageProtocol }),
        );
      el.addEventListener('error', onError);
      const resume = resumePosition(stream, startAt);
      const stopSeek = resume !== undefined ? seekWhenReady(el, resume, events) : undefined;
      cleanup = () => {
        el.removeEventListener('error', onError);
        stopSeek?.();
      };
      el.src = url;
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup?.();
      cleanup = undefined;
      events.clear();
      if (video) resetMediaElement(video);
      video = undefined;
    },

    on(evt, cb) {
      return events.on(evt, cb);
    },
  };
}
