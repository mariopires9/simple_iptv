// SRC-08: the active list selector in the top bar and its "Add list" chooser. Eager (TEC-01): the
// selector is always mounted, so its strings must not depend on loading the `sources` namespace.
export const lists = {
  selector: {
    label: (name: string) => `Active list: ${name}`,
    none: 'No list',
    noneLabel: 'Lists: no list yet',
    manage: 'Manage lists…',
    add: 'Add list',
  },
  switchFailed: 'Could not change the active list.',
  chooser: {
    title: 'Add list',
    xtream: { title: 'Xtream Codes', subtitle: 'Server, username and password (recommended)' },
    m3uUrl: { title: 'M3U list (URL)', subtitle: 'The address of an M3U list' },
    m3uFile: { title: 'Local M3U file', subtitle: 'Coming soon' },
  },
};
