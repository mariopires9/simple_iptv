// Minimal PlaybackError → localized text for the player error overlay (PLY-02).
// TODO(PLY-04): replace with the full error mapping (codec names, account/connection limits,
// DRM/DASH, required headers, diagnostics link) and the live retry backoff.
import { t } from '@/i18n';
import type { PlaybackError } from '../types';

export interface PlaybackErrorText {
  title: string;
  message: string;
}

export function describePlaybackError(error: PlaybackError): PlaybackErrorText {
  const texts = t.player.errors;
  if (error.kind === 'blocked' && error.hint === 'mixed-content') return texts.blockedMixedContent;
  return texts[error.kind];
}
