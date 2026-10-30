// PLY-08: hand a stream off to an external player (VLC). A web app cannot embed VLC or decode
// what the browser cannot (HEVC in TS, H.264 10-bit/4:2:2, MPEG-2 on iOS), so it opens VLC with
// the stream's DIRECT address — never the personal-proxy one: VLC can open http and needs no CORS.
//
// Pure helpers (link builders, `.m3u` content, platform), importable without the player UI (the
// Settings screen reads the default of its toggle here).
//
// Security (docs/SECURITY.md): every link and file built here carries the provider credentials of
// an Xtream stream. Never log them; build them only on an explicit tap.
import type { StreamDescriptor } from '../types';

/** How VLC is reached on this device. */
export type HandoffPlatform = 'ios' | 'android' | 'desktop';

export interface UserAgentInfo {
  userAgent: string;
  /** iPadOS 13+ reports itself as a Mac: touch points tell them apart. */
  maxTouchPoints?: number;
}

/**
 * Detects the hand-off platform from the user agent. User-agent sniffing is deliberate here: the
 * hand-off is a URL scheme of another app, which no feature test can observe.
 */
export function detectHandoffPlatform(info: UserAgentInfo): HandoffPlatform {
  const ua = info.userAgent;
  if (/\b(iPhone|iPod|iPad)\b/.test(ua)) return 'ios';
  if (/\bMacintosh\b/.test(ua) && (info.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/\bAndroid\b/i.test(ua)) return 'android';
  return 'desktop';
}

/** The current device's hand-off platform (desktop when there is no navigator). */
export function currentHandoffPlatform(): HandoffPlatform {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav) return 'desktop';
  return detectHandoffPlatform({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints });
}

/** Default of Settings › Playback › "Show 'Open in VLC'": on for phones and tablets. */
export function defaultShowOpenInVlc(
  platform: HandoffPlatform = currentHandoffPlatform(),
): boolean {
  return platform !== 'desktop';
}

/** Hand-off address of a descriptor: its own URLs, which are always the direct ones. */
export function externalStreamUrl(descriptor: StreamDescriptor): string {
  if (descriptor.externalUrl !== undefined) return descriptor.externalUrl;
  if (descriptor.kind === 'live') {
    // Live: MPEG-TS when the chain has it (VLC plays it without the HLS playlist round trips).
    const ts = [descriptor, ...(descriptor.fallbacks ?? [])].find((d) => d.container === 'ts');
    if (ts) return ts.url;
  }
  return descriptor.url;
}

/** iOS/iPadOS: VLC's x-callback-url "stream" action. */
export function vlcIosLink(url: string): string {
  return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;
}

/**
 * Android: an intent for VLC's package. Without VLC, Chrome opens its Play Store page (Android's
 * behaviour for an intent with `package`). Returns `undefined` for a non-http(s) address.
 */
export function vlcAndroidLink(url: string, title: string): string | undefined {
  const match = /^(https?):\/\/([^#]*)/i.exec(url);
  if (!match) return undefined;
  const scheme = (match[1] ?? 'http').toLowerCase();
  const rest = match[2] ?? '';
  return `intent://${rest}#Intent;scheme=${scheme};package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(title)};end`;
}

/** One line of text: an M3U title or a file name cannot carry line breaks. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

/** Desktop: a one-entry playlist VLC opens. Contains the credentials of an Xtream stream. */
export function vlcPlaylist(url: string, title: string): string {
  return `#EXTM3U\n#EXTINF:-1,${oneLine(title)}\n${oneLine(url)}\n`;
}

/** Longest file name stem kept (before `.m3u`). */
const MAX_STEM = 80;

/** A safe `.m3u` file name from the stream's name. */
export function vlcPlaylistFileName(title: string): string {
  const stem = oneLine(title)
    // Reserved on Windows/macOS/Linux, and control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_')
    .replace(/^[.\s_]+|[.\s]+$/g, '')
    .slice(0, MAX_STEM)
    .trim();
  return `${stem || 'stream'}.m3u`;
}
