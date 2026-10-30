// Test harness for the player UI (PLY-02). jsdom renders a real <video> element but implements no
// media behaviour, so `installFakeMedia` overrides the media properties and methods on that
// element instance and records what the UI does. The controller is replaced by `fakeController`.
// (`src/player/test-utils/fakeVideo.ts` is an EventTarget stand-in for engine tests; the UI needs
// a real DOM element, so this harness patches one instead — same TimeRanges approach.)
import { vi } from 'vitest';
import type { PlayerController, PlayerEvents } from '../../controller';

export interface FakeMedia {
  readonly video: HTMLVideoElement;
  readonly play: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly pause: ReturnType<typeof vi.fn<() => void>>;
  /** Next `play()` calls reject with a DOMException of these names (consumed in order). */
  rejectPlay(...names: string[]): void;
  setDuration(duration: number): void;
  setSeekable(ranges: Array<[number, number]>): void;
  /** Sets `currentTime` as playback would (fires `timeupdate`). */
  setTime(time: number): void;
  /** Dispatches a media event (`waiting`, `playing`, `loadeddata`…). */
  emit(type: string): void;
  /** Values assigned to `currentTime` by the UI. */
  readonly seeks: number[];
  /** `HTMLMediaElement.readyState` (0 by default). */
  readyState: number;
  /**
   * When true, `play()` resolves first and fires `play`/`playing` in a later microtask (the
   * order real browsers use: events are queued tasks). Default false (events fire inside play).
   */
  deferEvents: boolean;
}

export function installFakeMedia(video: HTMLVideoElement): FakeMedia {
  let paused = true;
  let muted = false;
  let volume = 1;
  let currentTime = 0;
  let duration = Number.NaN;
  let ranges: Array<[number, number]> = [];
  const rejections: string[] = [];
  const seeks: number[] = [];
  const emit = (type: string) => video.dispatchEvent(new Event(type));
  const state = { readyState: 0, deferEvents: false };

  const play = vi.fn(async () => {
    const name = rejections.shift();
    if (name !== undefined) throw new DOMException('play() refused', name);
    if (paused) {
      paused = false;
      const fire = () => {
        emit('play');
        emit('playing');
      };
      if (state.deferEvents) {
        // Several hops so the events land after the awaiting caller has resumed.
        void Promise.resolve()
          .then(() => undefined)
          .then(() => undefined)
          .then(fire);
      } else fire();
    }
  });
  const pause = vi.fn(() => {
    if (paused) return;
    paused = true;
    emit('pause');
  });

  const define = (name: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(video, name, { configurable: true, ...descriptor });
  define('play', { value: play });
  define('pause', { value: pause });
  define('load', { value: vi.fn() });
  define('paused', { get: () => paused });
  define('readyState', { get: () => state.readyState });
  define('ended', { get: () => false });
  define('duration', { get: () => duration });
  define('muted', {
    get: () => muted,
    set: (value: boolean) => {
      if (muted === value) return;
      muted = value;
      emit('volumechange');
    },
  });
  define('volume', {
    get: () => volume,
    set: (value: number) => {
      volume = value;
      emit('volumechange');
    },
  });
  define('currentTime', {
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      seeks.push(value);
      emit('seeking');
      emit('timeupdate');
      emit('seeked');
    },
  });
  define('seekable', {
    get: () =>
      ({
        length: ranges.length,
        start: (i: number) => ranges[i]?.[0] ?? 0,
        end: (i: number) => ranges[i]?.[1] ?? 0,
      }) as TimeRanges,
  });

  return {
    get readyState() {
      return state.readyState;
    },
    set readyState(value: number) {
      state.readyState = value;
    },
    get deferEvents() {
      return state.deferEvents;
    },
    set deferEvents(value: boolean) {
      state.deferEvents = value;
    },
    video,
    play,
    pause,
    seeks,
    rejectPlay: (...names) => rejections.push(...names),
    setDuration(value) {
      duration = value;
      emit('durationchange');
    },
    setSeekable(value) {
      ranges = value;
      emit('progress');
    },
    setTime(value) {
      currentTime = value;
      emit('timeupdate');
    },
    emit,
  };
}

export interface FakeController extends PlayerController {
  readonly play: ReturnType<typeof vi.fn<PlayerController['play']>>;
  readonly stop: ReturnType<typeof vi.fn<PlayerController['stop']>>;
  readonly selectAudioTrack: ReturnType<typeof vi.fn<PlayerController['selectAudioTrack']>>;
  readonly selectTextTrack: ReturnType<typeof vi.fn<PlayerController['selectTextTrack']>>;
  readonly reportStall: ReturnType<typeof vi.fn<PlayerController['reportStall']>>;
  emit<K extends keyof PlayerEvents>(evt: K, payload: PlayerEvents[K]): void;
  listenerCount(): number;
}

export function fakeController(): FakeController {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  return {
    play: vi.fn<PlayerController['play']>(async () => {}),
    stop: vi.fn<PlayerController['stop']>(async () => {}),
    on(evt, cb) {
      const set = listeners.get(evt) ?? new Set();
      set.add(cb as (payload: never) => void);
      listeners.set(evt, set);
      return () => {
        set.delete(cb as (payload: never) => void);
      };
    },
    emit(evt, payload) {
      for (const cb of [...(listeners.get(evt) ?? [])])
        (cb as (p: typeof payload) => void)(payload);
    },
    listenerCount() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
    engine: undefined,
    tracks: () => ({ audio: [], text: [] }),
    selectAudioTrack: vi.fn<PlayerController['selectAudioTrack']>(),
    selectTextTrack: vi.fn<PlayerController['selectTextTrack']>(),
    reportStall: vi.fn<PlayerController['reportStall']>(),
  };
}
