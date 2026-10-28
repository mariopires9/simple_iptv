// Player view, controls and announcements (PLY-02, docs/UX_UI.md §4.5).
export const player = {
  /** Accessible name of the player region. Argument: the stream title. */
  region: (title: string) => `Player: ${title}`,
  live: 'Live',
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
  /** Minimal playback error texts. TODO(PLY-04): replaced by the full error mapping. */
  errors: {
    network: {
      title: 'Connection problem',
      message: 'The stream could not be loaded because of a network error. Try again.',
    },
    blocked: {
      title: 'Stream blocked by the browser',
      message: 'The browser did not allow this stream to load. Try again or check the source.',
    },
    blockedMixedContent: {
      title: 'Insecure stream address',
      message:
        'This stream uses HTTP, which browsers block on a secure (HTTPS) page. Use an HTTPS source if the provider offers one.',
    },
    'unsupported-container': {
      title: 'Format not supported',
      message: 'This browser cannot play this stream format.',
    },
    'unsupported-codec': {
      title: 'Codec not supported',
      message: 'This browser cannot decode the video or audio of this stream.',
    },
    decode: {
      title: 'Playback failed',
      message: 'The stream could not be decoded. Try again.',
    },
    auth: {
      title: 'Access rejected',
      message: 'The provider rejected access to this stream. Check your account.',
    },
    unknown: {
      title: 'Playback failed',
      message: 'Something went wrong while playing this stream. Try again.',
    },
  },
};
