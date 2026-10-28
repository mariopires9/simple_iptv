// Live TV (LIV-01, LIV-02): categories, channel list, its states and the live player.
export const live = {
  title: 'Live TV',
  categories: 'Categories',
  virtualCategories: { favorites: 'Favorites', recent: 'Recent', all: 'All' },
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
    /** M3U entry with required headers that failed with 401/403 (PLY-04 AC8). */
    restricted:
      'The provider restricts playback to its own app/site: it requires headers (such as Referer or User-Agent) that browsers cannot send.',
  },
};
