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
import { currentPageProtocol, errorName, toPlaybackError } from './errors';
import { planPlayback } from './select';
import type { PlaybackCandidate } from './select';
import { PlaybackError } from './types';
import type {
  EngineFactory,
  EngineId,
  PlaybackNotice,
  PlayerEngine,
  StreamDescriptor,
} from './types';

export interface PlayerEvents {
  /** An engine starts loading a descriptor (`attempt` is its index: 0 = the requested one). */
  attempt: { engine: EngineId; descriptor: StreamDescriptor; attempt: number };
  /** A candidate cannot be played in this browser and is skipped without loading it. */
  skipped: { descriptor: StreamDescriptor; reason: 'unsupported'; attempt: number };
  /** The current attempt failed and `next` (a candidate that will be attempted) is tried. */
  fallback: { error: PlaybackError; next: StreamDescriptor };
  /** Non-fatal information about the current attempt (e.g. `resume-unsupported`). */
  notice: PlaybackNotice;
  /** Final failure: nothing left to try. Always emitted once when a play() ends in failure. */
  error: PlaybackError;
}

export interface PlayOptions {
  /** Start position in seconds (VOD resume; ignored for live). */
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
  /** Listener exceptions are caught and logged; they never affect playback. */
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
  const pageProtocol = options.pageProtocol ?? currentPageProtocol();

  const listeners: Listeners = {
    attempt: new Set(),
    skipped: new Set(),
    fallback: new Set(),
    notice: new Set(),
    error: new Set(),
  };
  const emit = <K extends keyof PlayerEvents>(evt: K, payload: PlayerEvents[K]) => {
    for (const cb of [...listeners[evt]]) {
      try {
        cb(payload);
      } catch (e) {
        log.error('player: event listener threw', { event: evt, error: errorName(e) });
      }
    }
  };

  /** Bumped by every play()/stop(); an operation whose token is stale stops at its next step. */
  let generation = 0;
  let current: { engine: PlayerEngine; unsubscribe: () => void } | undefined;

  async function teardown(): Promise<void> {
    const active = current;
    current = undefined;
    if (!active) return;
    try {
      active.unsubscribe();
    } catch (e) {
      log.warn('player: engine unsubscribe failed', {
        engine: active.engine.id,
        error: errorName(e),
      });
    }
    try {
      await active.engine.destroy();
    } catch (e) {
      log.warn('player: engine destroy failed', { engine: active.engine.id, error: errorName(e) });
    }
  }

  function unsupported(candidate: PlaybackCandidate): PlaybackError {
    return new PlaybackError({
      kind: 'unsupported-container',
      detail: `container:${candidate.descriptor.container}`,
      url: candidate.descriptor.url,
    });
  }

  function reportFinal(error: PlaybackError): void {
    log.warn('player: playback failed', {
      kind: error.kind,
      detail: error.detail,
      target: error.target,
    });
    emit('error', error);
  }

  /**
   * Tries `plan[index]` (skipping unsupported candidates). `failure` is the error of the attempt
   * that failed before this one (undefined for the requested descriptor); `unsupportedError`
   * remembers a skipped candidate so a plan with nothing playable still reports something.
   */
  async function attempt(
    token: number,
    plan: PlaybackCandidate[],
    index: number,
    startAt: number | undefined,
    failure?: PlaybackError,
    unsupportedError?: PlaybackError,
  ): Promise<void> {
    let i = index;
    let skippedError = unsupportedError;
    for (; i < plan.length; i++) {
      const candidate = plan[i];
      if (!candidate || candidate.engine !== 'unsupported') break;
      skippedError ??= unsupported(candidate);
      log.info('player: skipping unsupported descriptor', {
        container: candidate.descriptor.container,
        url: shortenUrl(candidate.descriptor.url),
      });
      emit('skipped', { descriptor: candidate.descriptor, reason: 'unsupported', attempt: i });
    }
    if (token !== generation) return; // a listener may have started another play()

    const candidate = plan[i];
    if (!candidate || candidate.engine === 'unsupported') {
      reportFinal(failure ?? skippedError ?? new PlaybackError({ kind: 'unknown' }));
      return;
    }
    if (failure) emit('fallback', { error: failure, next: candidate.descriptor });
    if (token !== generation) return;

    const { descriptor, engine: id } = candidate;
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
      await attempt(token, plan, i + 1, startAt, error, skippedError);
    };
    const failSafely = (error: PlaybackError) => {
      fail(error).catch((e: unknown) => {
        log.error('player: fallback failed', { error: errorName(e) });
        if (token === generation) reportFinal(error);
      });
    };
    const asPlaybackError = (e: unknown) =>
      toPlaybackError(e, { engine: id, url: descriptor.url, pageProtocol });

    try {
      const engine = engines[id]({ rewriter, pageProtocol });
      const unsubscribers = [
        engine.on('error', failSafely),
        engine.on('notice', (notice) => {
          if (token === generation && !failed) emit('notice', notice);
        }),
      ];
      current = { engine, unsubscribe: () => unsubscribers.forEach((off) => off()) };
      engine.attach(video);
      log.info('player: loading', {
        engine: id,
        container: descriptor.container,
        url: shortenUrl(descriptor.url),
      });
      emit('attempt', { engine: id, descriptor, attempt: i });
      if (token !== generation) return;
      await engine.load(descriptor, startAt);
    } catch (e) {
      if (token !== generation) return;
      await fail(asPlaybackError(e));
    }
  }

  return {
    async play(descriptor, playOptions = {}) {
      const token = ++generation;
      try {
        await teardown();
        // Rapid zapping: only the newest play() gets past this point.
        if (token !== generation) return;
        await attempt(token, planPlayback(descriptor, capabilities), 0, playOptions.startAt);
      } catch (e) {
        // Defensive: attempt() handles engine failures itself, so this is a controller bug.
        log.error('player: unexpected failure', { error: errorName(e) });
        if (token === generation) {
          reportFinal(
            new PlaybackError({ kind: 'unknown', detail: errorName(e), url: descriptor.url }),
          );
        }
      }
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
