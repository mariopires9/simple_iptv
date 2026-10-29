// Module player — see docs/ARCHITECTURE.md §3. Engines, selection and controller (PLY-01).
// hls.js and mpegts.js are never imported statically: each engine loads its library on first use.
export { createPlayerController } from './controller';
export type {
  PlayerController,
  PlayerControllerOptions,
  PlayerEvents,
  PlayOptions,
} from './controller';
export { NATIVE_AUDIO_CONTAINER, containerOfExtension, declaredContainer } from './containers';
export type { ContainerOrDash } from './containers';
export { planPlayback, selectEngine } from './select';
export type { EngineChoice, PlaybackCandidate, SelectionCapabilities } from './select';
export { PlaybackError, isPlaybackError, withAttempts } from './types';
export type {
  EngineDeps,
  EngineEvents,
  EngineFactory,
  EngineId,
  PlaybackAttempt,
  PlaybackErrorInit,
  PlaybackErrorKind,
  PlaybackNotice,
  PlayerEngine,
  StreamContainer,
  StreamDescriptor,
} from './types';
// PLY-06: the stream probe (`@/player/probe`) is not re-exported here: it is loaded on demand
// (after a playback failure, or by the diagnostics screen).
