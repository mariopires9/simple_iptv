// Settings › Playback (UX-04 AC1): reads and writes the playback preferences. Consumers:
// - `fullscreenOnLandscape` → PlayerView's rotation prompt (src/player/ui, PLY-03 AC3);
// - `showOpenInVlc` → PlayerView's "Open in VLC" action (PLY-08);
// - `playLastChannelOnOpen` → the Live screen (features/live/liveState.ts, LIV-03);
// - the active list's `prefs.liveFormat` → `resolveStream` (Xtream only; M3U entries carry their
//   own URL), applied from the next channel started; changing it, or "Reset learned formats",
//   forgets the formats learned per channel of that list (PLY-07, core/session/liveFormatMemory);
// - `hideProtectedContent` → the Live, Movies and Series grids, search and Home (UX-07), applied
//   the next time they load.
import {
  settingsRepo,
  sourcesRepo,
  type LiveFormat,
  type Source,
  type SourceKind,
} from '@/core/db';
import { loadActiveSource } from '@/core/session';
import { resetLearnedFormats } from '@/core/session/liveFormatMemory';
import { defaultShowOpenInVlc } from '@/player/external';

export const LIVE_FORMATS: readonly LiveFormat[] = ['auto', 'ts', 'm3u8'];

export interface ActiveListFormat {
  id: string;
  name: string;
  kind: SourceKind;
  liveFormat: LiveFormat;
}

export interface PlaybackSettings {
  /** Default on (the player only offers it on phones and tablets). */
  fullscreenOnLandscape: boolean;
  /** PLY-08: default on for phones and tablets, off on desktop. */
  showOpenInVlc: boolean;
  /** Default off (LIV-03). */
  playLastChannelOnOpen: boolean;
  /** Hide protected content (DRM/DASH, UX-07). Default off. */
  hideProtectedContent: boolean;
  /** The active list, whose live format the section edits; `undefined` without lists. */
  activeList: ActiveListFormat | undefined;
}

function toActiveList(source: Source | undefined): ActiveListFormat | undefined {
  if (!source) return undefined;
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    liveFormat: source.prefs.liveFormat,
  };
}

export async function loadPlaybackSettings(): Promise<PlaybackSettings> {
  const [fullscreen, showVlc, playLast, hideProtected, activeId] = await Promise.all([
    settingsRepo.get('fullscreenOnLandscape'),
    settingsRepo.get('showOpenInVlc'),
    settingsRepo.get('playLastChannelOnOpen'),
    settingsRepo.get('hideProtectedContent'),
    loadActiveSource(),
  ]);
  const source = activeId === undefined ? undefined : await sourcesRepo.get(activeId);
  return {
    fullscreenOnLandscape: fullscreen !== false,
    showOpenInVlc: typeof showVlc === 'boolean' ? showVlc : defaultShowOpenInVlc(),
    playLastChannelOnOpen: playLast === true,
    hideProtectedContent: hideProtected === true,
    activeList: toActiveList(source),
  };
}

export function saveFullscreenOnLandscape(enabled: boolean): Promise<void> {
  return settingsRepo.set('fullscreenOnLandscape', enabled);
}

export function saveShowOpenInVlc(enabled: boolean): Promise<void> {
  return settingsRepo.set('showOpenInVlc', enabled);
}

export function savePlayLastChannelOnOpen(enabled: boolean): Promise<void> {
  return settingsRepo.set('playLastChannelOnOpen', enabled);
}

export function saveHideProtectedContent(enabled: boolean): Promise<void> {
  return settingsRepo.set('hideProtectedContent', enabled);
}

/**
 * Sets the live format of a list (its other preferences kept). Rejects if the list is gone.
 * PLY-07: a new preference is an explicit choice, so the formats learned for the list are
 * forgotten (otherwise they would keep winning over it).
 */
export async function saveLiveFormat(sourceId: string, liveFormat: LiveFormat): Promise<void> {
  const source = await sourcesRepo.get(sourceId);
  if (!source) throw new Error('The list no longer exists');
  await sourcesRepo.update(sourceId, { prefs: { ...source.prefs, liveFormat } });
  await resetLearnedFormats(sourceId);
}

/** PLY-07: forgets the live format learned per channel of a list (Settings › Playback). */
export function resetLearnedLiveFormats(sourceId: string): Promise<void> {
  return resetLearnedFormats(sourceId);
}
