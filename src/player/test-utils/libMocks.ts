// Fakes of hls.js and mpegts.js for `vi.mock`. They mimic what matters for the lifecycle: the
// MediaSource object URL put on the element on attach and revoked on destroy, error events, and
// the calls the engines make. Use as:
//   vi.mock('hls.js', async () => (await import('./test-utils/libMocks')).hlsModule());
import { vi } from 'vitest';

type Handler = (...args: never[]) => void;

export const libState = {
  hlsSupported: true,
  mpegtsSupported: true,
  /** Simulate a library that forgets to revoke its object URL on destroy. */
  leakObjectUrl: false,
  hls: [] as FakeHls[],
  /** URLs requested through hls.js' default (base) loader. */
  hlsRequests: [] as string[],
  mpegts: [] as FakeMpegtsPlayer[],
  mpegtsLogListeners: [] as Array<(level: string, msg: string) => void>,
  mpegtsLogging: { enableAll: true },
};

export function resetLibState(): void {
  libState.hlsSupported = true;
  libState.mpegtsSupported = true;
  libState.leakObjectUrl = false;
  libState.hls.length = 0;
  libState.hlsRequests.length = 0;
  libState.mpegts.length = 0;
  libState.mpegtsLogListeners.length = 0;
  libState.mpegtsLogging.enableAll = true;
}

class Emitter {
  readonly handlers = new Map<string, Set<Handler>>();

  on(evt: string, handler: Handler): void {
    const set = this.handlers.get(evt) ?? new Set();
    set.add(handler);
    this.handlers.set(evt, set);
  }

  off(evt: string, handler: Handler): void {
    this.handlers.get(evt)?.delete(handler);
  }

  count(evt: string): number {
    return this.handlers.get(evt)?.size ?? 0;
  }

  fire(evt: string, ...args: unknown[]): void {
    for (const h of [...(this.handlers.get(evt) ?? [])]) (h as (...a: unknown[]) => void)(...args);
  }
}

interface MediaLike {
  src: string;
  removeAttribute(name: string): void;
}

class MediaSourceAttachment {
  private media: MediaLike | undefined;
  private objectUrl: string | undefined;

  attach(media: MediaLike): void {
    this.media = media;
    this.objectUrl = URL.createObjectURL(new Blob());
    media.src = this.objectUrl;
  }

  detach(): void {
    if (this.objectUrl && !libState.leakObjectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.media?.removeAttribute('src');
    }
    this.objectUrl = undefined;
    this.media = undefined;
  }
}

/** Stand-in for hls.js' default XHR loader: records the URL it is asked to fetch. */
export class FakeBaseLoader {
  context: { url: string } | null = null;
  stats = {};
  load(context: { url: string }) {
    this.context = context;
    libState.hlsRequests.push(context.url);
  }
  abort() {}
  destroy() {}
}

export class FakeHls extends Emitter {
  static isSupported = () => libState.hlsSupported;
  static Events = {
    ERROR: 'hlsError',
    FRAG_BUFFERED: 'hlsFragBuffered',
    BUFFER_CODECS: 'hlsBufferCodecs',
    AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
    AUDIO_TRACK_SWITCHED: 'hlsAudioTrackSwitched',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
  };
  static DefaultConfig = { loader: FakeBaseLoader };

  readonly config: Record<string, unknown>;
  readonly attachment = new MediaSourceAttachment();
  readonly recoverMediaError = vi.fn();
  readonly destroy = vi.fn(() => this.attachment.detach());
  source: string | undefined;
  attached = false;
  /** PLY-05: alternate renditions as hls.js lists them (`MediaPlaylist` subset). */
  audioTracks: Array<{ name: string; lang?: string }> = [];
  subtitleTracks: Array<{ name: string; lang?: string }> = [];
  subtitleDisplay = true;
  private audioIndex = -1;
  private subtitleIndex = -1;

  get audioTrack(): number {
    return this.audioIndex;
  }
  /** Like hls.js: switching fires AUDIO_TRACK_SWITCHED (without reloading the source). */
  set audioTrack(index: number) {
    this.audioIndex = index;
    this.fire(FakeHls.Events.AUDIO_TRACK_SWITCHED, FakeHls.Events.AUDIO_TRACK_SWITCHED, {});
  }
  get subtitleTrack(): number {
    return this.subtitleIndex;
  }
  set subtitleTrack(index: number) {
    this.subtitleIndex = index;
    this.fire(FakeHls.Events.SUBTITLE_TRACK_SWITCH, FakeHls.Events.SUBTITLE_TRACK_SWITCH, {});
  }

  /** Lists the manifest's renditions (AUDIO_TRACKS_UPDATED + SUBTITLE_TRACKS_UPDATED). */
  setTracks(
    audio: Array<{ name: string; lang?: string }>,
    subtitles: Array<{ name: string; lang?: string }>,
    audioIndex = audio.length > 0 ? 0 : -1,
  ) {
    this.audioTracks = audio;
    this.subtitleTracks = subtitles;
    this.audioIndex = audioIndex;
    this.fire(FakeHls.Events.AUDIO_TRACKS_UPDATED, FakeHls.Events.AUDIO_TRACKS_UPDATED, {});
    this.fire(FakeHls.Events.SUBTITLE_TRACKS_UPDATED, FakeHls.Events.SUBTITLE_TRACKS_UPDATED, {});
  }

  constructor(config: Record<string, unknown> = {}) {
    super();
    this.config = config;
    libState.hls.push(this);
  }

  attachMedia(media: MediaLike): void {
    this.attached = true;
    this.attachment.attach(media);
  }

  loadSource(url: string): void {
    this.source = url;
  }

  /** Fires `Hls.Events.ERROR` like hls.js does: `(event, data)`. */
  error(data: {
    type: string;
    details: string;
    fatal: boolean;
    response?: { code?: number };
    mimeType?: string;
    sourceBufferName?: string;
  }) {
    this.fire(FakeHls.Events.ERROR, FakeHls.Events.ERROR, data);
  }

  /** Fires `Hls.Events.BUFFER_CODECS` with the demuxed tracks. */
  bufferCodecs(data: { audio?: object; video?: object; audiovideo?: object }) {
    this.fire(FakeHls.Events.BUFFER_CODECS, FakeHls.Events.BUFFER_CODECS, data);
  }

  fragBuffered() {
    this.fire(FakeHls.Events.FRAG_BUFFERED, FakeHls.Events.FRAG_BUFFERED, {});
  }

  /** Issues a request through the configured loader, like hls.js does. */
  request(url: string, type: string) {
    const Loader = this.config.loader as new (c: unknown) => {
      load(ctx: unknown, cfg: unknown, cbs: unknown): void;
    };
    const noop = () => undefined;
    new Loader(this.config).load(
      { url, type, responseType: 'text' },
      {},
      {
        onSuccess: noop,
        onError: noop,
        onTimeout: noop,
      },
    );
  }
}

export class FakeMpegtsPlayer extends Emitter {
  readonly attachment = new MediaSourceAttachment();
  readonly load = vi.fn();
  readonly destroy = vi.fn(() => this.attachment.detach());
  currentTime = 0;

  constructor(
    readonly dataSource: { type: string; isLive?: boolean; url?: string },
    readonly config: Record<string, unknown>,
  ) {
    super();
    libState.mpegts.push(this);
  }

  attachMediaElement(media: MediaLike): void {
    this.attachment.attach(media);
  }

  /** Fires `Events.MEDIA_INFO` like mpegts.js does: `(mediaInfo)`. */
  mediaInfo(info: { hasAudio?: boolean; hasVideo?: boolean }) {
    this.fire('media_info', info);
  }

  /** Fires `Events.ERROR` like mpegts.js does: `(type, detail, info)`. */
  error(type: string, detail: string, info?: { code: number; msg: string }) {
    this.fire('error', type, detail, info);
  }
}

export function hlsModule() {
  return { default: FakeHls };
}

export function mpegtsModule() {
  const mpegts = {
    isSupported: () => libState.mpegtsSupported,
    Events: { ERROR: 'error', MEDIA_INFO: 'media_info' },
    LoggingControl: {
      set enableAll(value: boolean) {
        libState.mpegtsLogging.enableAll = value;
      },
      get enableAll() {
        return libState.mpegtsLogging.enableAll;
      },
      addLogListener: (listener: (level: string, msg: string) => void) => {
        libState.mpegtsLogListeners.push(listener);
      },
    },
    createPlayer: (dataSource: FakeMpegtsPlayer['dataSource'], config: Record<string, unknown>) =>
      new FakeMpegtsPlayer(dataSource, config),
  };
  return { default: mpegts };
}
