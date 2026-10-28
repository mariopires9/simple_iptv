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
  mpegts: [] as FakeMpegtsPlayer[],
  mpegtsLogListeners: [] as Array<(level: string, msg: string) => void>,
  mpegtsLogging: { enableAll: true },
};

export function resetLibState(): void {
  libState.hlsSupported = true;
  libState.mpegtsSupported = true;
  libState.leakObjectUrl = false;
  libState.hls.length = 0;
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

export class FakeHls extends Emitter {
  static isSupported = () => libState.hlsSupported;
  static Events = { ERROR: 'hlsError' };

  readonly config: Record<string, unknown>;
  readonly attachment = new MediaSourceAttachment();
  readonly recoverMediaError = vi.fn();
  readonly destroy = vi.fn(() => this.attachment.detach());
  source: string | undefined;
  attached = false;

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
  error(data: { type: string; details: string; fatal: boolean; response?: { code?: number } }) {
    this.fire(FakeHls.Events.ERROR, FakeHls.Events.ERROR, data);
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
    Events: { ERROR: 'error' },
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
