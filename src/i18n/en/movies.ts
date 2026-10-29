// Movies (VOD-01, VOD-02): categories, poster grid, sorting, details and the movie player.
export const movies = {
  title: 'Movies',
  categories: 'Categories',
  /** Virtual category with every movie of the list. */
  all: 'All',
  /** Synthetic category of M3U entries without a group (SRC-04 AC9). */
  uncategorized: 'Uncategorized',
  /** Accessible name of the poster grid. */
  gridLabel: (category: string) => `Movies in ${category}`,
  keyboardHint: 'Arrow keys move between movies, Enter opens the selected one.',
  loadingCard: 'Loading…',
  /** Visually hidden progress of a movie in "Continue watching" (e.g. "40% watched"). */
  watched: (percent: string) => `${percent} watched`,
  sort: {
    label: 'Sort by',
    added: 'Recently added',
    name: 'A–Z',
    rating: 'Rating',
  },
  noSource: {
    title: "You don't have any IPTV lists yet",
    message: 'Add a list to see its movies here.',
    add: 'Add a list',
    manage: 'My lists',
  },
  emptyCategory: { title: 'This category is empty.', showAll: 'Show all movies' },
  categoryNotFound: {
    title: 'Category not found',
    message: 'This category is not in the active list. It may have been removed by a sync.',
  },
  loadError: { title: "Couldn't load the movies", message: 'Try again in a moment.' },
  details: {
    back: 'Back to movies',
    play: 'Play',
    resumeAt: (time: string) => `Resume at ${time}`,
    addFavorite: 'Add to favorites',
    removeFavorite: 'Remove from favorites',
    favoriteAdded: (name: string) => `${name} added to favorites`,
    favoriteRemoved: (name: string) => `${name} removed from favorites`,
    favoriteFailed: (name: string) => `Couldn't update favorites for ${name}`,
    more: 'More',
    less: 'Less',
    /** Duration in hours and minutes, e.g. "1 h 42 min". */
    hoursMinutes: (hours: string, minutes: string) => `${hours} h ${minutes} min`,
    minutes: (minutes: string) => `${minutes} min`,
    /** Accessible text of the rating, e.g. "Rating 7.1 out of 10". */
    rating: (rating: string) => `Rating ${rating} out of 10`,
    director: 'Director',
    cast: 'Cast',
    synopsis: 'Synopsis',
    infoFailed: "Couldn't load more details. Showing the information from the list.",
    notFound: {
      title: 'Movie not found',
      message: 'This movie is not in the active list. It may have been removed by a sync.',
    },
    loadError: { title: "Couldn't load this movie", message: 'Try again in a moment.' },
  },
  player: {
    loading: (name: string) => `Loading ${name}…`,
    unsupported: {
      title: 'This movie uses DRM / DASH, which this app does not support',
      message: 'Protected (DRM) and DASH streams cannot be played in this app.',
    },
    credentials: {
      title: 'Re-enter the password for this list',
      message:
        "The saved password can't be read on this device any more. Enter it again in My lists to watch this list.",
      action: 'My lists',
    },
    unavailable: {
      title: "This movie can't be played",
      message: 'The list has no valid stream address for this movie. Try syncing the list.',
    },
    resolveError: {
      title: "Couldn't start this movie",
      message: 'Try again in a moment.',
    },
  },
};
