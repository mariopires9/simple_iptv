// Live TV (LIV-01): categories, channel list and its states.
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
  },
};
