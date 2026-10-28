// First-run onboarding (UX-01, docs/UX_UI.md §4.1) and the Privacy placeholder it links to.
export const onboarding = {
  title: 'Welcome to Simple IPTV',
  intro: 'Connect your IPTV subscription to start watching.',
  chooseType: 'How do you want to add your list?',
  options: {
    xtream: {
      title: 'Xtream Codes',
      description: 'Server, username and password from your provider.',
      recommended: 'Recommended',
    },
    m3uUrl: { title: 'M3U list (URL)', description: 'A link to an M3U or M3U8 playlist.' },
    m3uFile: { title: 'Local M3U file', description: 'A playlist file saved on this device.' },
  },
  note: "We don't include channels · your data stays on this device.",
  legal: 'Use only sources and content you are authorized to access.',
  learnMore: 'Learn more',
  /** Placeholder for Settings › Privacy and data (filled in by UX-04). */
  privacy: {
    title: 'Privacy and data',
    storage:
      'Your credentials are stored only on this device, encrypted. This prevents casual reading of the app’s data, but does not protect against someone with access to your unlocked device. Your credentials are also part of the channel addresses, which are sent to your provider. You can delete everything in Settings › Privacy.',
    noChannels:
      'Simple IPTV is a player: it does not provide, host or suggest channels or lists. There is no tracking or analytics.',
  },
};
