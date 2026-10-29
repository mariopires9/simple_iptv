// Series (SER-01, SER-02, SER-03): categories, poster grid, sorting, details with seasons and
// episodes, and the episode player with the next-episode card.
export const series = {
  title: 'Series',
  categories: 'Categories',
  /** Virtual category with every series of the list. */
  all: 'All',
  /** Synthetic category of entries without a group (SRC-04 AC9). */
  uncategorized: 'Uncategorized',
  /** Accessible name of the poster grid. */
  gridLabel: (category: string) => `Series in ${category}`,
  keyboardHint: 'Arrow keys move between series, Enter opens the selected one.',
  loadingCard: 'Loading…',
  /** Visually hidden progress on a card (e.g. "40% watched"). */
  watched: (percent: string) => `${percent} watched`,
  /** Card caption: number of seasons, when known. */
  seasonCount: (count: number, formatted: string) =>
    count === 1 ? '1 season' : `${formatted} seasons`,
  sort: {
    label: 'Sort by',
    added: 'Recently added',
    name: 'A–Z',
    rating: 'Rating',
  },
  noSource: {
    title: "You don't have any IPTV lists yet",
    message: 'Add a list to see its series here.',
    add: 'Add a list',
    manage: 'My lists',
  },
  emptyCategory: { title: 'This category is empty.', showAll: 'Show all series' },
  categoryNotFound: {
    title: 'Category not found',
    message: 'This category is not in the active list. It may have been removed by a sync.',
  },
  loadError: { title: "Couldn't load the series", message: 'Try again in a moment.' },
  details: {
    back: 'Back to series',
    /** "Play S1 E1" (no progress yet). */
    playEpisode: (season: string, episode: string) => `Play S${season} E${episode}`,
    /** SER-02 AC3: the episode to continue with. */
    continueEpisode: (season: string, episode: string) => `Continue S${season} E${episode}`,
    resumeAt: (time: string) => `Resume at ${time}`,
    startOver: 'Start from the beginning',
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
    /** Meta line: number of seasons. */
    seasonCount: (count: number, formatted: string) =>
      count === 1 ? '1 season' : `${formatted} seasons`,
    /** SER-02 AC2: a season without a usable name. */
    season: (number: string) => `Season ${number}`,
    /** Label of the season selector. */
    /** Season 0 of the panels. */
    specials: 'Specials',
    seasons: 'Seasons',
    /** Accessible name of the episode list. */
    episodesOf: (season: string) => `Episodes of ${season}`,
    /** Episode number on a row ("E03"). */
    episodeCode: (number: string) => `E${number}`,
    /** An episode without a title. */
    episode: (number: string) => `Episode ${number}`,
    watched: 'Watched',
    /** Progress of an episode in progress (e.g. "40% watched"). */
    progress: (percent: string) => `${percent} watched`,
    infoLoading: 'Loading the episodes…',
    infoFailed: {
      title: "Couldn't load the episodes",
      message: 'The server did not answer. Try again in a moment.',
    },
    noEpisodes: {
      title: 'No episodes',
      message: 'The server has no episodes for this series yet.',
    },
    notFound: {
      title: 'Series not found',
      message: 'This series is not in the active list. It may have been removed by a sync.',
    },
    loadError: { title: "Couldn't load this series", message: 'Try again in a moment.' },
  },
  player: {
    loading: (name: string) => `Loading ${name}…`,
    /** Player title of an episode, e.g. "Example Drama · S1 E2 · Pilot". */
    title: (series: string, season: string, episode: string, title: string) =>
      `${series} · S${season} E${episode} · ${title}`,
    unsupported: {
      title: 'This episode uses DRM / DASH, which this app does not support',
      message: 'Protected (DRM) and DASH streams cannot be played in this app.',
    },
    credentials: {
      title: 'Re-enter the password for this list',
      message:
        "The saved password can't be read on this device any more. Enter it again in My lists to watch this list.",
      action: 'My lists',
    },
    unavailable: {
      title: "This episode can't be played",
      message: 'The list has no valid stream address for this episode. Try syncing the list.',
    },
    resolveError: {
      title: "Couldn't start this episode",
      message: 'Try again in a moment.',
    },
    /** SER-03 AC2: the countdown card. */
    nextEpisode: {
      countdown: (seconds: string) => `Next episode in ${seconds} s`,
      label: (season: string, episode: string, title: string) =>
        `S${season} E${episode} · ${title}`,
      playNow: 'Play now',
      cancel: 'Cancel',
    },
  },
};
