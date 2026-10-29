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
    blocked: {
      title: 'Stream blocked by the browser',
      message:
        'The browser blocked this stream. The server probably does not allow access from web apps (CORS) or does not use HTTPS. The connection diagnostics explain what you can do.',
    },
    blockedMixedContent: {
      title: 'Insecure stream address',
      message:
        'This stream uses HTTP, which browsers block on a secure (HTTPS) page. Use an HTTPS source if the provider offers one; the connection diagnostics explain other options.',
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
  /** iPhone: fullscreen is the system player (our controls are not shown there). */
  nativeFullscreenNote: 'On this device, fullscreen uses the system player and its controls.',
};
