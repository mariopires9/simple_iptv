// PLY-08: performs the hand-off to VLC — a URL scheme (iOS), an intent (Android) or a one-entry
// `.m3u` download (desktop). Called only from an explicit tap; never logs the address.
import {
  currentHandoffPlatform,
  vlcAndroidLink,
  vlcIosLink,
  vlcPlaylist,
  vlcPlaylistFileName,
  type HandoffPlatform,
} from './index';

/** The object URL of a downloaded playlist is revoked after this long (the download has begun). */
export const PLAYLIST_URL_REVOKE_MS = 10_000;

export interface HandoffEnv {
  platform: HandoffPlatform;
  /** Opens another app's link (default: `location.href = …`). */
  navigate: (href: string) => void;
  /** Saves a file (default: Blob + object URL + `<a download>`, URL revoked afterwards). */
  download: (blob: Blob, fileName: string) => void;
}

/** What the user was handed: VLC itself (iOS, Android) or a playlist file to open with it. */
export type HandoffOutcome = 'opened' | 'downloaded';

function navigateTo(href: string): void {
  window.location.href = href;
}

/** Downloads `blob` as `fileName`; the object URL is always revoked. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Not at once: some browsers start reading the URL only after the click event returns.
    setTimeout(() => URL.revokeObjectURL(url), PLAYLIST_URL_REVOKE_MS);
  }
}

export function defaultHandoffEnv(): HandoffEnv {
  return { platform: currentHandoffPlatform(), navigate: navigateTo, download: downloadBlob };
}

/** Hands `url` (the DIRECT stream address) to VLC. */
export function handOffToVlc(url: string, title: string, env: HandoffEnv): HandoffOutcome {
  if (env.platform === 'ios') {
    env.navigate(vlcIosLink(url));
    return 'opened';
  }
  if (env.platform === 'android') {
    const intent = vlcAndroidLink(url, title);
    if (intent !== undefined) {
      env.navigate(intent);
      return 'opened';
    }
  }
  const blob = new Blob([vlcPlaylist(url, title)], { type: 'audio/x-mpegurl' });
  env.download(blob, vlcPlaylistFileName(title));
  return 'downloaded';
}
