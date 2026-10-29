// SCH-02: global search screen. Lazy namespace (TEC-01): loads with the search route. The top-bar
// search button only uses `nav.search` (eager).
export const search = {
  title: 'Search',
  fieldLabel: 'Search channels, movies and series',
  placeholder: 'Channel, movie or series',
  hint: 'Type at least 2 characters to search the active list.',
  groups: {
    live: 'Live TV',
    movie: 'Movies',
    series: 'Series',
  },
  /** Group heading with its number of matches. */
  groupHeading: (name: string, total: number) => `${name} (${total})`,
  seeAll: (name: string, total: number) => `See all ${total} in ${name}`,
  allResults: 'All results',
  showingFirst: (shown: number, total: number) => `Showing the first ${shown} of ${total}.`,
  /** Polite announcement after each search. */
  announce: (total: number) =>
    total === 0 ? 'No results' : total === 1 ? '1 result' : `${total} results`,
  channelNumber: (n: number) => `No. ${n}`,
  noResults: {
    title: 'No results',
    message: (query: string) => `Nothing in the active list matches “${query}”.`,
  },
  noList: {
    title: 'No list',
    message: 'Add a list to search its channels, movies and series.',
    action: 'Add list',
  },
  error: {
    title: 'Search is not available',
    message: 'The search could not be run. Try again.',
  },
  recent: {
    title: 'Recent searches',
    clear: 'Clear',
    clearLabel: 'Clear recent searches',
    empty: 'Your recent searches will appear here.',
  },
};
