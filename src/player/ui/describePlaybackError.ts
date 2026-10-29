// PlaybackError → localized text and actions for the player error overlay (PLY-04).
import { t } from '@/i18n';
import type { PlaybackError } from '../types';
import { containerName, formatCodecs } from './codecNames';

/** Extra action offered next to "Try again" (and "Next channel" on live). */
export type PlaybackErrorAction = 'diagnostics';

export interface PlaybackErrorText {
  title: string;
  message: string;
  action?: PlaybackErrorAction;
}

export interface DescribeContext {
  /** Live or VOD: a live network error is final only after the automatic reconnects. */
  kind?: 'live' | 'vod';
  /**
   * The entry declares headers (Referer/User-Agent…) the browser cannot send (PLY-04 AC8): a
   * 401/403 then means the provider restricts playback to its own site or app.
   */
  requiredHeaders?: boolean;
}

/** hls.js reports DRM-protected streams it cannot handle as key-system errors. */
const isDrm = (error: PlaybackError) => /^keySystem/i.test(error.detail ?? '');

export function describePlaybackError(
  error: PlaybackError,
  context: DescribeContext = {},
): PlaybackErrorText {
  const texts = t.player.errors;
  const rejected = error.kind === 'auth' || error.status === 401 || error.status === 403;
  if (rejected && context.requiredHeaders === true) return texts.restricted;

  switch (error.kind) {
    case 'blocked':
      return {
        ...(error.hint === 'mixed-content' ? texts.blockedMixedContent : texts.blocked),
        action: 'diagnostics',
      };
    case 'auth':
      return texts.auth;
    case 'network':
      return context.kind === 'live' ? texts.networkLive : texts.network;
    case 'unsupported-codec':
      return {
        title: texts['unsupported-codec'].title,
        message:
          error.codec !== undefined
            ? texts.codecNamed(formatCodecs(error.codec))
            : texts['unsupported-codec'].message,
      };
    case 'unsupported-container': {
      if (isDrm(error)) return texts.drm;
      const base = texts['unsupported-container'];
      if (error.codec !== undefined) {
        return { title: base.title, message: texts.codecNamed(formatCodecs(error.codec)) };
      }
      if (error.detail === 'mseUnsupported') return { title: base.title, message: texts.noMse };
      // Skipped candidate (see the controller): `container:<name>`.
      const container = /^container:(.+)$/.exec(error.detail ?? '')?.[1];
      const name = container !== undefined ? containerName(container) : undefined;
      return name !== undefined ? { title: base.title, message: texts.containerNamed(name) } : base;
    }
    case 'decode':
      return texts.decode;
    case 'unknown':
      return texts.unknown;
  }
}
