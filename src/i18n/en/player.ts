// Player view, controls and announcements (PLY-02, docs/UX_UI.md §4.5).
export const player = {
  /** BCP 47 tag used to format numbers (times, percentages) in the player. */
  locale: 'en',
  /** Accessible name of the player region. Argument: the stream title. */
  region: (title: string) => `Player: ${title}`,
  live: 'Live',
  /** Closes a banner (no sound, iPhone fullscreen note). */
  dismiss: 'Dismiss',
  controls: {
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    volume: 'Volume',
    seek: 'Seek',
    back10: 'Back 10 seconds',
    forward10: 'Forward 10 seconds',
    previousChannel: 'Previous channel',
    nextChannel: 'Next channel',
    channelList: 'Channel list',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    pictureInPicture: 'Picture-in-picture',
    exitPictureInPicture: 'Exit picture-in-picture',
    close: 'Close player',
    goLive: 'Go live',
  },
  /** Slider value for assistive technology. Arguments are already formatted times. */
  timeOf: (current: string, total: string) => `${current} of ${total}`,
  /** Polite live-region announcements. */
  announce: {
    playing: 'Playing',
    paused: 'Paused',
    muted: 'Muted',
    unmuted: 'Sound on',
    buffering: 'Buffering…',
    mutedAutoplay: 'Playing without sound. Use Unmute to turn the sound on.',
  },
  /** Playback errors (PLY-04): overlay title + message, keyed by `PlaybackErrorKind`. */
  errors: {
    network: {
      title: 'Connection problem',
      message: 'The stream could not be loaded because of a network error. Try again.',
    },
    /** Live, after the automatic reconnects failed. */
    networkLive: {
      title: 'Connection lost',
      message:
        'The channel could not be reconnected after several attempts. Check your connection and try again, or switch to another channel.',
    },
    /** The browser reports no network (PWA-04). Never promises offline playback. */
    offline: {
      title: 'No connection',
      message: 'Playing needs an internet connection. Check your connection and try again.',
    },
    blocked: {
      title: 'Stream blocked by the browser',
      message:
        'The browser blocked this stream. The server probably does not allow access from web apps (CORS) or does not use HTTPS. You can route this list through your personal proxy (Settings › Personal proxy); the connection diagnostics explain other options.',
    },
    blockedMixedContent: {
      title: 'Insecure stream address',
      message:
        'This stream uses HTTP, which browsers block on a secure (HTTPS) page. Use an HTTPS source if the provider offers one, or route this list through your personal proxy (Settings › Personal proxy); the connection diagnostics explain other options.',
    },
    'unsupported-container': {
      title: 'Format or codec not supported',
      message:
        'This browser cannot play the format or codec of this stream, or the stream is not available.',
    },
    'unsupported-codec': {
      title: 'Format or codec not supported',
      message: 'This browser cannot decode the video or audio of this stream.',
    },
    /** Argument: codec display names (e.g. `HEVC (H.265), AC-3 (Dolby Digital)`). */
    codecNamed: (codec: string) =>
      `This browser does not support the codec of this stream: ${codec}.`,
    /** Argument: container display name (e.g. `AVI`). */
    containerNamed: (container: string) => `This browser cannot play ${container} streams.`,
    noMse:
      'This browser cannot play this kind of stream (Media Source Extensions are not available).',
    decode: {
      title: 'Playback failed',
      message: 'The stream could not be decoded. Try again.',
    },
    auth: {
      title: 'Access rejected',
      message:
        'The provider rejected access to this stream. Your account may be expired or inactive, or it may have reached its maximum number of simultaneous connections: close other players using it and try again.',
    },
    restricted: {
      title: 'Playback restricted by the provider',
      message:
        'The provider restricts playback to its own app/site: it requires headers (such as Referer or User-Agent) that browsers cannot send.',
    },
    drm: {
      title: 'This channel uses DRM / DASH, which this app does not support',
      message: 'Protected (DRM) and DASH streams cannot be played in this app.',
    },
    unknown: {
      title: 'Playback failed',
      message: 'Something went wrong while playing this stream. Try again.',
    },
    actions: {
      diagnostics: 'Connection diagnostics',
    },
  },
  /** Live: automatic reconnect after a network error. Arguments: attempt number and maximum. */
  reconnecting: (attempt: number, max: number) => `Reconnecting… (attempt ${attempt} of ${max})`,
  /** Video plays but the browser cannot decode the audio (PLY-04 AC3). */
  noAudio: {
    /** Argument: codec display name (e.g. `AC-3 (Dolby Digital)`). */
    codec: (codec: string) => `No sound: audio ${codec} is not supported in this browser.`,
    unknown: 'No sound: this browser may not support the audio of this stream.',
  },
  /** Video plays without picture: the browser cannot decode the video track. */
  noVideo: {
    /** Argument: codec display name (e.g. `HEVC (H.265)`). */
    codec: (codec: string) => `No picture: video codec ${codec} is not supported in this browser.`,
    unknown: 'No picture: the video codec of this stream is not supported in this browser.',
  },
  /** Shown briefly when the device turns to landscape (fullscreen needs a tap). */
  tapForFullscreen: 'Tap for fullscreen',
  /** iPhone: fullscreen is the system player (our controls are not shown there). */
  nativeFullscreenNote: 'On this device, fullscreen uses the system player and its controls.',
  /** VOD-03 AC4: the saved position cannot be reached (no range requests / not seekable). */
  resumeUnsupported: 'Starting from the beginning',
  /** PLY-06: every format the player tried, in the error details (technical, copyable). */
  attempts: {
    heading: 'Attempts:',
    /** Arguments: position, format (e.g. `MPEG-TS`), engine label, technical error text. */
    line: (position: number, format: string, engine: string, error: string) =>
      `${position}. ${format} via ${engine}: ${error}`,
    /** A format this browser cannot play: skipped without loading it. */
    skipped: 'not playable in this browser (skipped)',
    engines: { native: 'native player', hls: 'hls.js', mpegts: 'mpegts.js' },
    mediaSources: { mse: 'Media Source Extensions', mms: 'ManagedMediaSource' },
    /** Arguments: engine name and Media Source API name. */
    withMediaSource: (engine: string, api: string) => `${engine} (${api})`,
    /** Arguments: finding code (e.g. `insecure-redirect`) and comma-separated facts. */
    probe: (finding: string, facts: string) =>
      `   Check: ${finding}${facts !== '' ? ` (${facts})` : ''}`,
    redirected: 'redirected',
    hevc: 'HEVC',
    /** Argument: HTTP status code. */
    status: (status: number) => `HTTP ${status}`,
    copy: 'Copy details',
    copied: 'Details copied',
    copyFailed: 'The details could not be copied. Open "Details" and copy the text.',
  },
  /**
   * PLY-06: why a stream failed, from a check of its address made after the failure. Never
   * promises a fix: these explain what the browser allows.
   */
  probe: {
    checking: 'Checking the cause…',
    title: 'Likely cause',
    causes: {
      ok: 'The address answers and looks like a valid stream: the problem is the format or codec of this stream in this browser, not the connection.',
      'insecure-url':
        'The stream address uses http://, which the browser blocks inside a secure (https) app. This provider needs a player app on your device: browsers on https cannot play http streams.',
      'insecure-redirect':
        'The server redirects the stream to an insecure http:// address, which the browser blocks inside an https app. This provider needs a player app on your device: browsers on https cannot play http streams.',
      'insecure-segments':
        'The playlist points to insecure http:// addresses, which the browser blocks inside an https app. This provider needs a player app on your device: browsers on https cannot play http streams.',
      'redirect-blocked':
        'The server redirects the stream to another address that the browser could not open — usually an insecure http:// address, which browsers block inside an https app. If so, this provider needs a player app on your device.',
      'no-cors':
        'The server does not allow web apps to read the stream (no CORS headers), so this format cannot play in the browser. Try the other live format for this list (HLS plays natively in Safari).',
      'no-cors-native':
        'The server does not allow web apps to read the playlist (no CORS headers). The native player does not need that, so it is not the cause, and the browser does not say why it refused the stream.',
      unreachable:
        'The browser could not open the stream address: the server sends no CORS headers, is unreachable, or the request was blocked — the browser does not say which.',
      auth: 'The provider rejected the request (HTTP 401/403): the account may be expired or at its limit of simultaneous connections.',
      'http-error': 'The server answered the stream request with an error.',
      'not-media':
        'The server answered with something that is not a stream (for example an error page).',
      timeout: 'The check took too long: the cause could not be determined.',
      'invalid-url': 'The stream address is not valid.',
    },
    hevc: 'The stream uses HEVC (H.265) video, which this browser may not be able to play in this format.',
  },
};
