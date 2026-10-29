// Settings (UX-04), interface language (UX-06), storage (PWA-05) and the Privacy and data page.
// The screen title lives in `routes.screens.settings` (eager); theme names in `nav.themes`.
export const settings = {
  sections: {
    sources: 'Lists',
    appearance: 'Appearance',
    language: 'Language',
    playback: 'Playback',
    proxy: 'Personal proxy',
    storage: 'Storage',
    privacy: 'Privacy',
    about: 'About',
  },
  sources: {
    myLists: 'My lists',
    myListsHint: 'Add, switch, refresh or remove your IPTV lists',
  },
  appearance: {
    theme: 'Theme',
  },
  language: {
    label: 'Interface language',
    /** "System" with the language it currently resolves to. */
    system: (current: string) => `System (${current})`,
    /** Language names, always written in their own language (docs/UX_UI.md §4.8). */
    names: { en: 'English', 'pt-PT': 'Português' },
  },
  playback: {
    fullscreenOnLandscape: 'Fullscreen in landscape',
    fullscreenOnLandscapeHint:
      'On phones and tablets, turning the device sideways during playback offers fullscreen',
    playLastChannel: 'Play the last channel on open',
    playLastChannelHint: 'When Live TV opens, the channel you watched last starts playing',
    liveFormat: 'Preferred live format',
    liveFormatHint: (list: string) =>
      `For the active list (${list}). Auto picks what this browser plays best.`,
    liveFormatNotXtream: 'Only Xtream Codes lists offer a choice of live format.',
    liveFormatNoList: 'Add an Xtream Codes list to choose its live format.',
    liveFormats: { auto: 'Auto', ts: 'MPEG-TS', m3u8: 'HLS' },
    saveError: 'The setting could not be saved. Try again.',
  },
  /** PRX-01: the personal proxy (a relay the user runs on their own computer, ADR-010). */
  proxy: {
    intro:
      'For providers that only work over HTTP: route a list through a proxy you run on your own computer, for example reachable with Tailscale Serve. Lists connect directly unless you choose otherwise below.',
    url: 'Proxy address',
    urlHint: 'The HTTPS address of your proxy, for example https://my-pc.example.ts.net',
    token: 'Access token',
    tokenHint: 'The token configured in your proxy',
    tokenKeep: 'A token is saved. Leave this empty to keep it.',
    showToken: 'Show token',
    save: 'Save',
    test: 'Test connection',
    testing: 'Testing…',
    remove: 'Remove proxy',
    saved: 'Proxy saved',
    removed: 'Proxy removed. Every list connects directly again.',
    saveError: 'The proxy could not be saved. Try again.',
    removeError: 'The proxy could not be removed. Try again.',
    testError: 'The test could not be run. Try again.',
    errors: {
      baseUrl: {
        empty: 'Enter the address of your proxy.',
        invalid: 'Enter a valid address, starting with https://.',
        'too-long': 'This address is too long.',
        insecure: 'The address must use HTTPS (http:// only works for this device itself).',
        credentials: 'Remove the user name and password from the address.',
        query: 'Remove the part after ? or # from the address.',
      },
      token: {
        required: 'Enter the token configured in your proxy.',
        invalid: 'The token has 32 to 128 characters: letters, digits, - or _.',
      },
    },
    outcomes: {
      ok: (streams: string) => `Your proxy answered. Streams it is relaying now: ${streams}.`,
      okList: (list: string, streams: string) =>
        `Your proxy answered and allows the server of ${list}. Streams it is relaying now: ${streams}.`,
      auth: 'The proxy rejected the token. Check that it is the one configured in the proxy.',
      unreachable:
        'The proxy could not be reached. Check that Tailscale is on on this device, that the address uses HTTPS, and that the computer running the proxy is awake with the proxy started.',
      notProxy: 'This address does not answer like a Simple IPTV proxy. Check the address.',
      notAllowed: (list: string) =>
        `The proxy works, but the server of ${list} is not in its list of allowed hosts. Add it to the proxy’s allowlist.`,
    },
    routing: {
      title: 'Lists',
      hint: 'Streams only: the player goes through the proxy. Streams and API: the list’s downloads and programme guide too.',
      disabledHint: 'Save a proxy to route lists through it.',
      noLists: 'You have no lists yet.',
      label: (list: string) => `Proxy for ${list}`,
      options: { off: 'Off (direct)', streams: 'Streams only', all: 'Streams and API' },
      saveError: 'The list’s setting could not be saved. Try again.',
    },
  },
  storage: {
    persisted: 'Persistent storage',
    persistedOn: 'On: the browser will not delete the app’s data to free up space.',
    persistedOff: 'Off: the browser may delete the app’s data when the device runs low on space.',
    persistedUnknown: 'This browser does not report whether the data is kept.',
    request: 'Ask again',
    requestDenied: 'The browser did not allow it. Installing the app usually helps.',
    usage: 'Space used',
    usageOf: (used: string, quota: string) => `${used} of ${quota}`,
    usageUnknown: 'This browser does not report the space used.',
    iosInstall:
      'Install the app to prevent Safari from deleting your data after 7 days without use',
  },
  privacy: {
    title: 'Privacy and data',
    summary: 'Everything stays on this device. There is no account, tracking or analytics.',
    storage:
      'Your credentials are stored only on this device, encrypted. This prevents casual reading of the app’s data, but does not protect against someone with access to your unlocked device. Your credentials are also part of the channel addresses, which are sent to your provider. You can delete everything in Settings › Privacy.',
    noChannels:
      'Simple IPTV is a player: it does not provide, host or suggest channels or lists. There is no tracking or analytics.',
    whatWeStore: 'What is stored on this device',
    stored: {
      lists: 'Your lists: name, server address and user name.',
      credentials:
        'Passwords and list addresses, encrypted with a key that never leaves this browser.',
      catalog: 'The channels, movies, series and programme guide downloaded from your lists.',
      personal: 'Favorites, watch history and recent searches.',
      preferences: 'Settings such as theme, language and the last channel.',
    },
    notSent:
      'Nothing is sent to us: the app only talks to the servers of the lists you add. To remove a list and its data, use My lists.',
    /** SRC-10: delete everything the app stored on this device. */
    deleteAll: {
      title: 'Delete all data',
      description:
        'Removes every list, password, channel, favorite, watch history entry and setting from this device. The app stays installed. This cannot be undone.',
      action: 'Delete all data…',
      dialog: {
        title: 'Delete all data?',
        message:
          'Everything this app stored on this device is deleted and the app starts again from the beginning. Your subscriptions are not affected.',
        /** The word to type to confirm (localized). */
        confirmWord: 'DELETE',
        confirmLabel: (word: string) => `Type ${word} to confirm`,
        confirm: 'Delete everything',
        deleting: 'Deleting…',
      },
      failed: {
        title: 'Some data could not be deleted',
        message:
          'Try again. If it keeps failing, close this app in other tabs or windows first, then try again.',
        partsTitle: 'Not deleted:',
        parts: {
          database: 'Lists, channels, favorites and settings',
          caches: 'Cached files',
          storage: 'Preferences kept by the browser (language, theme)',
        },
        /** The database is gone: the app restarts when the dialog is closed. */
        deletedNote:
          'Your lists, channels and settings were deleted. The app starts again from the beginning when you continue.',
        /** The deletion waits for other tabs: the app restarts when it completes. */
        pendingNote:
          'The deletion is waiting for this app to close in other tabs or windows. It finishes on its own once they are closed.',
        retry: 'Try again',
        close: 'Close',
        continue: 'Continue',
      },
    },
  },
  about: {
    version: 'Version',
    licenses: 'Open-source licenses',
    licensesHint: 'The open-source software this app is built with',
    licensesLoading: 'Loading the licenses…',
    licensesUnavailable: 'The list of licenses is not available in this build.',
    legal: 'The app does not provide content; it only uses sources you are authorized to access.',
  },
};
