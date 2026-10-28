// Playback capability detection (PLY-01, docs/RESEARCH.md §5, docs/ARCHITECTURE.md §3).
// Everything is feature detection, except `isIOS`/`isSafari` — see the note on `detectAppleWebKit`.

/** Static side of `MediaSource` / `ManagedMediaSource` that detection needs. */
export interface MediaSourceLike {
  isTypeSupported(type: string): boolean;
}

/** The parts of a `<video>` element that detection needs. */
export interface ProbeVideoLike {
  canPlayType(type: string): string;
  /** Safari: present on iPhone, where only the native fullscreen player exists. */
  webkitEnterFullscreen?: unknown;
  /** Safari: Picture-in-Picture before the standard API. */
  webkitSetPresentationMode?: unknown;
}

/** Injectable environment, so detection is testable without a real browser. */
export interface PlatformEnv {
  MediaSource?: MediaSourceLike | undefined;
  ManagedMediaSource?: MediaSourceLike | undefined;
  createVideo(): ProbeVideoLike;
  document: {
    pictureInPictureEnabled?: boolean;
    fullscreenEnabled?: boolean;
    webkitFullscreenEnabled?: boolean;
  };
  navigator: {
    userAgent: string;
    vendor?: string;
    platform?: string;
    maxTouchPoints?: number;
  };
}

export interface Capabilities {
  /** W3C Media Source Extensions (`MediaSource`). */
  mse: boolean;
  /** Apple `ManagedMediaSource` (Safari 17+, iOS 17.1+); the only MSE flavour on iPhone. */
  mms: boolean;
  /** The `<video>` element reports HLS support (Safari, recent Chrome). */
  nativeHls: boolean;
  /** `true` if the `<video>` element or MSE/MMS report support for the MIME type (with codecs). */
  canPlay(mime: string): boolean;
  /** iPhone, iPod or iPad (including iPadOS with a desktop user agent). */
  isIOS: boolean;
  /** Apple's Safari (macOS or iOS); third-party iOS browsers count as Safari too (same WebKit). */
  isSafari: boolean;
  /** Picture-in-Picture available (standard API or the Safari presentation mode). */
  pip: boolean;
  /** Element Fullscreen API available (not on iPhone, which only has `webkitEnterFullscreen`). */
  fullscreenApi: boolean;
}

const HLS_MIME_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegURL'];

/** The real browser environment. Only call where `window`/`document` exist. */
export function browserEnv(): PlatformEnv {
  const g = globalThis as {
    MediaSource?: MediaSourceLike;
    ManagedMediaSource?: MediaSourceLike;
  };
  return {
    MediaSource: g.MediaSource,
    ManagedMediaSource: g.ManagedMediaSource,
    createVideo: () => document.createElement('video'),
    document: document as PlatformEnv['document'],
    navigator,
  };
}

function hasTypeSupport(source: MediaSourceLike | undefined): source is MediaSourceLike {
  return source !== undefined && source !== null && typeof source.isTypeSupported === 'function';
}

function safely(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

/**
 * Apple WebKit detection. This is the one place where user-agent sniffing is unavoidable:
 * - The engine rule "HLS on Safari/iOS → native first" (RESEARCH §5.2) is about Apple's media
 *   stack (AirPlay, battery, no CORS for segments), not about `canPlayType` — recent Chrome also
 *   answers `maybe` for HLS but should keep using hls.js.
 * - iPadOS 13+ sends a macOS desktop user agent, so `platform === 'MacIntel'` with touch points
 *   is the documented way to tell an iPad from a Mac.
 * `navigator.vendor` is `Apple Computer, Inc.` for every WebKit browser on iOS and for Safari on
 * macOS; Chrome reports `Google Inc.` and Firefox an empty string.
 */
function detectAppleWebKit(nav: PlatformEnv['navigator']): { isIOS: boolean; isSafari: boolean } {
  const ua = nav.userAgent;
  const iPadAsMac = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
  const isIOS = /\b(iPhone|iPod|iPad)\b/.test(ua) || iPadAsMac;
  const appleVendor = (nav.vendor ?? '').startsWith('Apple');
  const isSafari = isIOS || (appleVendor && /Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua));
  return { isIOS, isSafari };
}

/** Detects the playback capabilities of the current (or an injected) environment. */
export function getCapabilities(env: PlatformEnv = browserEnv()): Capabilities {
  const video = env.createVideo();
  const mediaSource = hasTypeSupport(env.MediaSource) ? env.MediaSource : undefined;
  const managed = hasTypeSupport(env.ManagedMediaSource) ? env.ManagedMediaSource : undefined;

  const canPlay = (mime: string): boolean =>
    safely(() => video.canPlayType(mime) !== '') ||
    safely(() => mediaSource?.isTypeSupported(mime) === true) ||
    safely(() => managed?.isTypeSupported(mime) === true);

  const { isIOS, isSafari } = detectAppleWebKit(env.navigator);

  return {
    mse: mediaSource !== undefined,
    mms: managed !== undefined,
    nativeHls: HLS_MIME_TYPES.some((mime) => safely(() => video.canPlayType(mime) !== '')),
    canPlay,
    isIOS,
    isSafari,
    pip:
      env.document.pictureInPictureEnabled === true ||
      typeof video.webkitSetPresentationMode === 'function',
    fullscreenApi:
      env.document.fullscreenEnabled === true || env.document.webkitFullscreenEnabled === true,
  };
}
