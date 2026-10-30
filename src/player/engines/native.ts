// Native <video> engine (PLY-01): MP4/WebM/MOV/MKV everywhere, HLS on Safari/iOS.
import { mapMediaError } from '../errors';
import { NO_TRACKS } from '../types';
import type { EngineDeps, MediaTrack, MediaTracks, PlayerEngine, StreamDescriptor } from '../types';
import {
  createEngineEmitter,
  requireVideo,
  resetMediaElement,
  resumePosition,
  seekWhenReady,
  toMediaTrack,
} from './shared';

/** `HTMLMediaElement.audioTracks` (Safari; not in TypeScript's DOM types). */
interface NativeAudioTrack {
  label: string;
  language: string;
  enabled: boolean;
}
interface NativeAudioTrackList extends EventTarget {
  readonly length: number;
  [index: number]: NativeAudioTrack | undefined;
}

function audioTrackList(video: HTMLVideoElement): NativeAudioTrackList | undefined {
  return (video as { audioTracks?: NativeAudioTrackList }).audioTracks;
}

const isSubtitle = (track: TextTrack | undefined): track is TextTrack =>
  track?.kind === 'subtitles' || track?.kind === 'captions';

/** PLY-05: the element's own audio and text tracks (native HLS on Safari); ids are indexes. */
export function readNativeTracks(video: HTMLVideoElement): MediaTracks {
  const audio: MediaTrack[] = [];
  let audioId: string | undefined;
  const audioList = audioTrackList(video);
  for (let i = 0; i < (audioList?.length ?? 0); i++) {
    const track = audioList?.[i];
    if (!track) continue;
    audio.push(toMediaTrack(String(i), track.label, track.language));
    if (track.enabled && audioId === undefined) audioId = String(i);
  }
  const text: MediaTrack[] = [];
  let textId: string | undefined;
  const textList = video.textTracks as TextTrackList | undefined;
  for (let i = 0; i < (textList?.length ?? 0); i++) {
    const track = textList?.[i];
    if (!isSubtitle(track)) continue;
    text.push(toMediaTrack(String(i), track.label, track.language));
    if (track.mode === 'showing' && textId === undefined) textId = String(i);
  }
  return {
    audio,
    text,
    ...(audioId !== undefined ? { audioId } : {}),
    ...(textId !== undefined ? { textId } : {}),
  };
}

const TRACK_LIST_EVENTS = ['addtrack', 'removetrack', 'change'] as const;

export function createNativeEngine({ rewriter, pageProtocol }: EngineDeps): PlayerEngine {
  const events = createEngineEmitter();
  let video: HTMLVideoElement | undefined;
  let cleanup: (() => void) | undefined;
  let destroyed = false;

  return {
    id: 'native',

    tracks: () => (video ? readNativeTracks(video) : NO_TRACKS),

    selectAudioTrack(id) {
      const list = video ? audioTrackList(video) : undefined;
      if (!list || list[Number(id)] === undefined) return;
      // Enable the chosen one first: a list never goes through "no audio track enabled".
      const chosen = list[Number(id)];
      if (chosen) chosen.enabled = true;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        if (track && track !== chosen) track.enabled = false;
      }
    },

    selectTextTrack(id) {
      const list = video?.textTracks as TextTrackList | undefined;
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        if (isSubtitle(track)) track.mode = String(i) === id ? 'showing' : 'disabled';
      }
    },

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
      const onTracks = () => events.emit('tracks', readNativeTracks(el));
      const lists: EventTarget[] = [];
      const audioList = audioTrackList(el);
      if (audioList) lists.push(audioList);
      if ((el.textTracks as TextTrackList | undefined) !== undefined) lists.push(el.textTracks);
      for (const list of lists) {
        for (const type of TRACK_LIST_EVENTS) list.addEventListener(type, onTracks);
      }
      const resume = resumePosition(stream, startAt);
      const stopSeek = resume !== undefined ? seekWhenReady(el, resume, events) : undefined;
      cleanup = () => {
        el.removeEventListener('error', onError);
        for (const list of lists) {
          for (const type of TRACK_LIST_EVENTS) list.removeEventListener(type, onTracks);
        }
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
