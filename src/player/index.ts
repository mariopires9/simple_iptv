// Module player — see docs/ARCHITECTURE.md §3. Engines, selection and controller (PLY-01).
// hls.js and mpegts.js are never imported statically: each engine loads its library on first use.
export { createPlayerController } from './controller';
export type {
  PlayerController,
  PlayerControllerOptions,
  PlayerEvents,
  PlayOptions,
} from './controller';
export { planPlayback, selectEngine } from './select';
export type { EngineChoice, PlaybackCandidate, SelectionCapabilities } from './select';
export { PlaybackError, isPlaybackError } from './types';
export type {
  EngineDeps,
  EngineFactory,
  EngineId,
  PlaybackErrorInit,
  PlaybackErrorKind,
  PlayerEngine,
  StreamContainer,
  StreamDescriptor,
} from './types';
