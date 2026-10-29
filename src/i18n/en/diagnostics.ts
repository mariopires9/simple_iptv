// Compatibility diagnostics of a list (SRC-09, docs/UX_UI.md §4.1b/§4.8). Loaded with the
// diagnostics screen. Never promise what the browser cannot do: no offline playback, no proxy yet.
export const diagnostics = {
  title: 'Diagnostics',
  back: 'My lists',
  intro:
    'Checks whether this list can work in this browser and what you can do if it does not. It makes one request to your provider’s API and opens the first live channel briefly (no more than its first bytes).',
  running: 'Checking…',
  runAgain: 'Check again',
  copy: 'Copy report',
  copied: 'Report copied',
  /** The live format of the list could not be saved. */
  formatSaveFailed: 'The live format could not be changed. Try again.',
  copyFailed: 'The report could not be copied automatically. Select the text below and copy it.',
  reportLabel: 'Diagnostics report',
  notFound: {
    title: 'List not found',
    message: 'This list no longer exists. It may have been removed.',
  },
  loadError: {
    title: 'The list could not be loaded',
    message: 'Your saved data could not be read. Try again.',
  },
  summary: {
    ok: 'No problems found.',
    warning: 'This list should work, with some limitations.',
    error: 'Problems found: see below what you can do.',
    skipped: 'Nothing could be checked.',
  },
  status: { ok: 'OK', warning: 'Warning', error: 'Problem', skipped: 'Not checked' },
  yes: 'yes',
  no: 'no',
  checks: {
    https: {
      title: 'HTTPS',
      reasons: {
        https: 'The list uses a secure (HTTPS) address.',
        'http-blocked':
          'The list uses HTTP. This app runs on a secure (HTTPS) page, and browsers block HTTP requests from secure pages (mixed content).',
        'http-local':
          'The list uses HTTP. It works on this local page, but browsers block it in the published (HTTPS) app.',
        'not-applicable': 'Not needed: the list is a file on this device.',
      },
      httpsAvailable: 'The server also answers over HTTPS.',
    },
    api: {
      title: 'API access (CORS)',
      reasons: {
        ok: 'The browser can read the provider’s answers.',
        'auth-rejected':
          'The server answered, so the browser can reach it, but it rejected the username or password.',
        'mixed-content':
          'The browser blocked the request because the server uses HTTP on a secure page (mixed content).',
        cors: 'The browser blocked the request. The server most likely does not allow access from web apps (CORS), or the address is wrong or unreachable.',
        timeout: 'The server did not answer in time.',
        'network-error': 'The request did not complete.',
        'http-error': 'The server answered with an error.',
        'invalid-response':
          'The server answered with something that is not a valid list or API answer.',
        offline: 'Not checked: there is no network connection.',
        'no-secret':
          'Not checked: the saved login or address could not be read. Edit the list and enter it again.',
        'invalid-address':
          'Not checked: the saved server address of this list is not valid. Edit the list and correct it.',
        'not-applicable': 'Not needed: the list is a file on this device.',
      },
      /** Argument: HTTP status code. */
      httpStatus: (status: string) => `HTTP status ${status}.`,
    },
    liveFormat: {
      title: 'Live format (TS/HLS)',
      reasons: {
        ok: 'Live channels can play in this browser in the chosen format.',
        'format-not-allowed':
          'Your account does not allow the chosen live format. Choose another one for this list.',
        'format-unplayable':
          'This browser cannot play the chosen live format. Choose another one for this list.',
        'none-playable': 'This browser cannot play any live format this list offers.',
        'per-channel':
          'Each channel’s address decides its format; this browser can play both MPEG-TS and HLS.',
        'per-channel-partial':
          'Each channel’s address decides its format; this browser can only play some of them.',
      },
      /** Argument: format name. */
      configured: (format: string) => `Chosen format: ${format}.`,
      /** Argument: comma-separated format names. */
      allowed: (formats: string) => `Formats allowed by the account: ${formats}.`,
      /** Argument: e.g. `MPEG-TS (mpegts.js), HLS (native player)`. */
      playable: (formats: string) => `This browser plays: ${formats}.`,
      playableNone: 'This browser plays: none.',
      formats: { auto: 'Auto', ts: 'MPEG-TS', m3u8: 'HLS' },
      engines: { native: 'native player', hls: 'hls.js', mpegts: 'mpegts.js' },
    },
    /** PLY-06: the first live channel of the list, probed in each live format. */
    liveStream: {
      title: 'Live stream test',
      /** Reasons that are not a probe finding (findings use `player.probe.causes`). */
      reasons: {
        partial: 'Live channels can play in one format but not in the other.',
        'no-channels': 'Not checked: this list has no live channels (refresh it first).',
        offline: 'Not checked: there is no network connection.',
        'no-secret':
          'Not checked: the saved login could not be read. Edit the list and enter it again.',
        unavailable: 'Not checked: the first live channel has no address this app can open.',
      },
      /** Arguments: format name, engine name (or `not playable here`), result, masked address. */
      fact: (format: string, engine: string, result: string, address: string) =>
        `${format} (${engine}): ${result} — ${address}`,
      notPlayable: 'not playable here',
      /** Short results per probe finding (the explanation uses the full sentence). */
      results: {
        ok: 'answers, looks like a stream',
        'insecure-url': 'http:// address (blocked in an https app)',
        'insecure-redirect': 'redirects to http:// (blocked in an https app)',
        'insecure-segments': 'playlist lists http:// addresses (blocked in an https app)',
        'redirect-blocked': 'redirects to an address the browser could not open',
        'no-cors': 'no CORS headers (web engines cannot read it)',
        'no-cors-native': 'no CORS headers (not needed by the native player)',
        unreachable: 'no CORS or unreachable (the browser does not say which)',
        auth: 'access rejected',
        'http-error': 'HTTP error',
        'not-media': 'not a stream',
        timeout: 'no answer in time',
        'invalid-url': 'invalid address',
      },
      /** Arguments: HTTP status. */
      status: (status: string) => `HTTP ${status}`,
      redirected: 'redirected',
      hevc: 'HEVC video',
    },
    browser: {
      title: 'Browser support',
      reasons: {
        mse: 'This browser supports Media Source Extensions, which the app uses for most streams.',
        mms: 'This browser supports Managed Media Source, which the app uses for most streams.',
        'native-hls-only':
          'This browser only plays HLS natively: MPEG-TS live channels cannot play here.',
        none: 'This browser has no way to play live streams (no Media Source Extensions and no native HLS).',
      },
      /** Arguments: localized yes/no. */
      facts: (mse: string, mms: string, nativeHls: string) =>
        `Media Source Extensions: ${mse} · Managed Media Source: ${mms} · Native HLS: ${nativeHls}.`,
    },
    codecs: {
      title: 'Codecs',
      reasons: {
        all: 'This browser reports support for every codec tested.',
        'optional-missing':
          'Some codecs are not supported: channels that use them may play without picture or sound.',
        'required-missing':
          'This browser does not support H.264 or AAC, which almost every stream uses.',
      },
      names: {
        h264: 'H.264',
        hevc: 'HEVC (H.265)',
        aac: 'AAC',
        ac3: 'AC-3 (Dolby Digital)',
        eac3: 'E-AC-3 (Dolby Digital Plus)',
      },
      /** Arguments: codec name and localized yes/no. */
      fact: (codec: string, supported: string) => `${codec}: ${supported}`,
      note: 'Support reported by the browser; actual playback also depends on the device.',
    },
  },
  actionsTitle: 'What you can do',
  actions: {
    'use-https':
      'Use an HTTPS address if your provider offers one: edit the list and change the address to https://.',
    'local-file':
      'Download the list (M3U) on this device and add it as a file. This avoids the list request; each channel’s address must still work in the browser.',
    safari:
      'Try Safari (Mac, iPhone or iPad): it plays HLS natively and supports more codecs, such as Dolby audio and HEVC.',
    'proxy-future':
      'A personal proxy you run yourself could get around these limits. This app does not support one yet.',
    'check-network': 'Check your internet connection.',
    'check-credentials': 'Check the username, password and server address of the list.',
    'contact-provider': 'Ask your provider whether their service works in web browsers.',
    'switch-live-format': 'Change the preferred live format of this list.',
    'device-app':
      'This provider sends its streams over http://, which browsers block inside a secure (https) app: use a player app on your device for this list, or ask the provider for https streams.',
    retry: 'Try again in a moment.',
  },
  links: {
    editList: 'Edit list',
    addList: 'Add a list',
    /** Argument: format name. Changes this list's preferred live format. */
    useFormat: (format: string) => `Use ${format} for this list`,
  },
  report: {
    heading: 'Simple IPTV — compatibility diagnostics',
    date: 'Date',
    listType: 'List type',
    address: 'Address (hidden)',
    page: 'App page',
    privacy: 'Credentials and the server address are hidden in this report.',
    actions: 'What you can do',
  },
};
