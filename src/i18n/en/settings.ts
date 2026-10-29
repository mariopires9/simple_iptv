// Settings (UX-04), interface language (UX-06), storage (PWA-05) and the Privacy and data page.
// The screen title lives in `routes.screens.settings` (eager); theme names in `nav.themes`.
export const settings = {
  sections: {
    sources: 'Lists',
    appearance: 'Appearance',
    language: 'Language',
    playback: 'Playback',
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
