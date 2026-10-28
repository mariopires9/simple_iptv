// Player controller (PLY-01, docs/ARCHITECTURE.md §6.2): selects the engine, runs the fallbacks,
// owns the engine lifecycle on one reused <video> element. No UI.
import { log } from '@/core/log';
import { identityRewriter, shortenUrl } from '@/core/net';
import type { UrlRewriter } from '@/core/net';
import { getCapabilities } from '@/core/platform';
import type { Capabilities } from '@/core/platform';
import { createHlsEngine } from './engines/hls';
import { createMpegtsEngine } from './engines/mpegts';
import { createNativeEngine } from './engines/native';
import { toPlaybackError } from './errors';
import { planPlayback } from './select';
import type { PlaybackCandidate } from './select';
import { PlaybackError } from './types';
import type { EngineFactory, EngineId, PlayerEngine, StreamDescriptor } from './types';

export interface PlayerEvents {
  /** An engine starts loading a descriptor (`attempt` 0 is the requested one). */
  attempt: { engine: EngineId; descriptor: StreamDescriptor; attempt: number };
  /** The current attempt failed and the next fallback is about to be tried. */
  fallback: { error: PlaybackError; next: StreamDescriptor };
  /** Final failure: no fallback left. */
  error: PlaybackError;
}

export interface PlayOptions {
  /** Start position in seconds (VOD resume). */
  startAt?: number;
}

export interface PlayerController {
  /**
   * Plays `descriptor`, trying its fallbacks (each once) on failure. Never rejects: the final
   * failure is emitted as `error`. A newer `play()`/`stop()` supersedes this one; the promise
   * then resolves without loading anything further. Starting playback (`video.play()`) and the
   * autoplay policy are the caller's job.
   */
  play(descriptor: StreamDescriptor, options?: PlayOptions): Promise<void>;
  /** Destroys the current engine and empties the element. */
  stop(): Promise<void>;
  on<K extends keyof PlayerEvents>(evt: K, cb: (payload: PlayerEvents[K]) => void): () => void;
  /** Engine currently attached, if any. */
  readonly engine: EngineId | undefined;
}

export interface PlayerControllerOptions {
  /** Default {@link identityRewriter}. */
  rewriter?: UrlRewriter;
  /** Default: detected once with {@link getCapabilities}. */
  capabilities?: Capabilities;
  /** Engine factories (tests inject fakes). */
  engines?: Partial<Record<EngineId, EngineFactory>>;
  /** Default: `location.protocol`. */
  pageProtocol?: string;
}

const DEFAULT_ENGINES: Record<EngineId, EngineFactory> = {
  native: createNativeEngine,
  hls: createHlsEngine,
  mpegts: createMpegtsEngine,
};

type Listeners = { [K in keyof PlayerEvents]: Set<(payload: PlayerEvents[K]) => void> };

export function createPlayerController(
  video: HTMLVideoElement,
  options: PlayerControllerOptions = {},
): PlayerController {
  const rewriter = options.rewriter ?? identityRewriter;
  const capabilities = options.capabilities ?? getCapabilities();
  const engines = { ...DEFAULT_ENGINES, ...options.engines };
  const pageProtocol = options.pageProtocol ?? globalThis.location?.protocol;

  const listeners: Listeners = { attempt: new Set(), fallback: new Set(), error: new Set() };
  const emit = <K extends keyof PlayerEvents>(evt: K, payload: PlayerEvents[K]) => {
    for (const cb of [...listeners[evt]]) cb(payload);
  };

  /** Bumped by every play()/stop(); an operation whose token is stale stops at its next step. */
  let generation = 0;
  let current: { engine: PlayerEngine; unsubscribe: () => void } | undefined;

  async function teardown(): Promise<void> {
    const active = current;
    current = undefined;
    if (!active) return;
    active.unsubscribe();
    try {
      await active.engine.destroy();
    } catch (e) {
      log.warn('player: engine destroy failed', { engine: active.engine.id, error: String(e) });
    }
  }

  function unsupported(candidate: PlaybackCandidate): PlaybackError {
    return new PlaybackError({
      kind: 'unsupported-container',
      detail: `container:${candidate.descriptor.container}`,
      url: candidate.descriptor.url,
    });
  }

  async function attempt(
    token: number,
    plan: PlaybackCandidate[],
    index: number,
    startAt: number | undefined,
    previousError?: PlaybackError,
  ): Promise<void> {
    let lastError = previousError;
    let i = index;
    for (; i < plan.length; i++) {
      const candidate = plan[i];
      if (candidate && candidate.engine !== 'unsupported') break;
      if (candidate) {
        lastError ??= unsupported(candidate);
        log.info('player: skipping unsupported descriptor', {
          container: candidate.descriptor.container,
          url: shortenUrl(candidate.descriptor.url),
        });
      }
    }
    const candidate = plan[i];
    if (!candidate || candidate.engine === 'unsupported') {
      const error = lastError ?? new PlaybackError({ kind: 'unknown' });
      log.warn('player: playback failed', {
        kind: error.kind,
        detail: error.detail,
        target: error.target,
      });
      emit('error', error);
      return;
    }

    const { descriptor, engine: id } = candidate;
    const engine = engines[id]({ rewriter, pageProtocol });
    let failed = false;

    const fail = async (error: PlaybackError): Promise<void> => {
      if (failed || token !== generation) return;
      failed = true;
      log.warn('player: attempt failed', {
        engine: id,
        kind: error.kind,
        detail: error.detail,
        target: error.target,
      });
      await teardown();
      if (token !== generation) return;
      const next = plan[i + 1];
      if (next) emit('fallback', { error, next: next.descriptor });
      await attempt(token, plan, i + 1, startAt, error);
    };

    const unsubscribe = engine.on('error', (error) => void fail(error));
    current = { engine, unsubscribe };
    engine.attach(video);
    log.info('player: loading', {
      engine: id,
      container: descriptor.container,
      url: shortenUrl(descriptor.url),
    });
    emit('attempt', { engine: id, descriptor, attempt: i });

    try {
      await engine.load(descriptor, startAt);
    } catch (e) {
      if (token !== generation) return;
      await fail(toPlaybackError(e, { engine: id, url: descriptor.url, pageProtocol }));
    }
  }

  return {
    async play(descriptor, playOptions = {}) {
      const token = ++generation;
      await teardown();
      // Rapid zapping: only the newest play() gets past this point.
      if (token !== generation) return;
      await attempt(token, planPlayback(descriptor, capabilities), 0, playOptions.startAt);
    },

    async stop() {
      generation++;
      await teardown();
    },

    on(evt, cb) {
      const set = listeners[evt] as Set<typeof cb>;
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },

    get engine() {
      return current?.engine.id;
    },
  };
}
