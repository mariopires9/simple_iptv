// Live TV (LIV-01..04, EPG-01): categories, channel list and filter, its states, the live player
// and the now/next programme guide.
export const live = {
  title: 'Live TV',
  categories: 'Categories',
  virtualCategories: { favorites: 'Favorites', recent: 'Recent', all: 'All' },
  /** Synthetic category of M3U entries without a group (SRC-04 AC9). */
  uncategorized: 'Uncategorized',
  /** Accessible name of the channel listbox. */
  channelsIn: (category: string) => `Channels in ${category}`,
  /** Visually hidden suffix of a favorite channel's option (the star is decorative). */
  favorite: 'Favorite',
  /** Tooltip/label of the star on a row (mouse and touch; the keyboard uses F). */
  toggleFavorite: (name: string) => `Toggle favorite: ${name}`,
  favoriteAdded: (name: string) => `${name} added to favorites`,
  favoriteRemoved: (name: string) => `${name} removed from favorites`,
  favoriteFailed: (name: string) => `Couldn't update favorites for ${name}`,
  loadingRow: 'Loading…',
  keyboardHint: 'Arrow keys move, Enter plays, F adds or removes a favorite.',
  filter: {
    label: 'Filter channels',
    placeholder: 'Filter channels…',
    hint: 'Type part of a name or a channel number. Esc clears the filter.',
    clear: 'Clear filter',
    /** Announced politely after each change of the filter. */
    results: (count: number) =>
      count === 0
        ? 'No channels match'
        : count === 1
          ? '1 channel matches'
          : `${count} channels match`,
    failed: "Couldn't filter this category. The full list is shown.",
    noMatches: (query: string) => `No channels match “${query}”`,
  },
  epg: {
    /** Accessible name of the now/next block under the player. */
    region: 'Program guide',
    now: 'Now',
    next: 'Next',
    times: (start: string, end: string) => `${start}–${end}`,
    progress: (title: string) => `Progress of ${title}`,
    /** Visually hidden prefix of the current programme on a channel row. */
    rowNow: 'Now:',
  },
  guide: {
    /** Button on the Live screen and page title. */
    open: 'TV guide',
    title: 'TV guide',
    back: 'Back to Live TV',
    category: 'Category',
    /** Accessible name of the grid. */
    gridLabel: (category: string) => `TV guide: ${category}`,
    keyboardHint:
      'Arrow keys move between programmes and channels, Enter shows the details, Home goes back to now.',
    /** Header cell of the channel column. */
    channels: 'Channels',
    /** Marker of the current time on the timeline. */
    nowLine: 'Now',
    onNow: 'On now',
    noInfo: 'No guide information',
    /** Accessible name of an empty stretch of a row (the keyboard can land on it). */
    gap: (channel: string, start: string, end: string) =>
      `${channel}, ${start}–${end}, no guide information. Enter plays the channel.`,
    /** Accessible name of a programme cell. */
    cell: (title: string, start: string, end: string, onNow: boolean) =>
      `${title}, ${start}–${end}${onNow ? ', on now' : ''}`,
    /** Accessible name of the channel header cell (click plays). */
    channel: (name: string) => `Play ${name}`,
    details: {
      channel: (name: string) => `On ${name}`,
      noDescription: 'No description.',
      watch: 'Watch channel',
      close: 'Close',
    },
    noEpg: {
      title: 'No guide for this list',
      message:
        'This list has no programme guide. For M3U lists, add a guide address in the list settings.',
    },
    empty: 'No channels in this category.',
  },
  noSource: {
    title: "You don't have any IPTV lists yet",
    message: 'Add a list to see its live channels here.',
    add: 'Add a list',
    manage: 'My lists',
  },
  emptyCategory: { title: 'This category is empty.', showAll: 'Show all channels' },
  emptyFavorites: {
    title: 'No favorite channels yet',
    message: 'Select a channel and press F or the star to add it here.',
  },
  emptyRecent: {
    title: 'No recent channels yet',
    message: 'Channels you watch will appear here.',
  },
  categoryNotFound: {
    title: 'Category not found',
    message: 'This category is not in the active list. It may have been removed by a sync.',
  },
  loadError: { title: "Couldn't load the channels", message: 'Try again in a moment.' },
  player: {
    idle: 'Select a channel to watch it here.',
    /** Accessible name of the player area. */
    region: (name: string) => `Player: ${name}`,
    /** Shown (and announced) as soon as a channel is chosen, before its stream starts. */
    watching: (name: string) => `Watching ${name}`,
    loading: (name: string) => `Loading ${name}…`,
    channels: 'Channels',
    closeChannels: 'Close the channel list',
    unsupported: {
      title: 'This channel uses DRM / DASH, which this app does not support',
      message: 'Protected (DRM) and DASH streams cannot be played in this app.',
    },
    credentials: {
      title: 'Re-enter the password for this list',
      message:
        "The saved password can't be read on this device any more. Enter it again in My lists to watch this list.",
      action: 'My lists',
    },
    unavailable: {
      title: "This channel can't be played",
      message: 'The list has no valid stream address for this channel. Try syncing the list.',
    },
    resolveError: {
      title: "Couldn't start this channel",
      message: 'Try again in a moment.',
    },
  },
};
