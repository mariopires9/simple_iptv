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
};
