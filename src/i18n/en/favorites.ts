// Home and Favorites screens (FAV-01, FAV-02, FAV-03). Screen titles live in `routes` (eager).
export const favorites = {
  sections: {
    continueWatching: 'Continue watching',
    recentChannels: 'Recent channels',
    favorites: 'Favorites',
  },
  seeAllLabel: (section: string) => `See all: ${section}`,
  seeAll: 'See all',
  /** Hint for the horizontal rows (screen readers). */
  rowHint: 'Use the left and right arrow keys to move between items.',
  /** Watched fraction of a movie or episode; the argument is already formatted (e.g. "45%"). */
  watched: (percent: string) => `${percent} watched`,
  /** Season and episode numbers of the episode to resume. */
  episode: (season: number, episode: number) => `S${season} · E${episode}`,
  empty: {
    title: 'Nothing to show yet',
    message:
      'What you watch and the channels, movies and series you mark as favorites will appear here.',
    live: 'Watch Live TV',
    movies: 'Browse movies',
    series: 'Browse series',
  },
  loadError: {
    title: 'Could not load your content',
    message: 'Something went wrong while reading the data saved on this device.',
  },
  clearHistory: {
    button: 'Clear history',
    title: 'Clear history?',
    message:
      'Recent channels and "Continue watching" of the active list will be removed. Your favorites are kept.',
    confirm: 'Clear history',
    done: 'History cleared.',
    failed: 'Could not clear the history. Try again.',
  },
  screen: {
    tabsLabel: 'Favorite types',
    tabs: { live: 'Channels', movie: 'Movies', series: 'Series' },
    empty: {
      live: 'No favorite channels yet.',
      movie: 'No favorite movies yet.',
      series: 'No favorite series yet.',
    },
    emptyHint: 'Mark an item with ★ to find it here.',
    browse: { live: 'Browse Live TV', movie: 'Browse movies', series: 'Browse series' },
    unavailable: 'Unavailable',
    unavailableHint: 'No longer in this list',
    remove: 'Remove',
    removeLabel: (name: string) => `Remove ${name} from favorites`,
    removeUnavailableLabel: 'Remove unavailable item from favorites',
    removed: (name: string) => `${name} removed from favorites`,
    removedUnavailable: 'Unavailable item removed from favorites',
    removeFailed: 'Could not update your favorites. Try again.',
  },
};
