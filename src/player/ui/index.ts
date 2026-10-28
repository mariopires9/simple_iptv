// Player UI (PLY-02). Kept apart from `@/player` so importing player types or the controller does
// not pull the UI (MUI controls) into a bundle: features load this module with a dynamic import.
export { PlayerView, DVR_MIN_WINDOW_S, BUFFERING_SPINNER_DELAY_MS } from './PlayerView';
export type { PlayerViewProps } from './PlayerView';
export type { ControllerFactory } from './usePlayerController';
export { formatTime } from './formatTime';
