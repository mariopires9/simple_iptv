// Routing (FND-04): screen titles and placeholder texts, not-found and the route error boundary
// message. Generic titles and action labels (retry, reload) live in `state` (UX-02).
export const routes = {
  screens: {
    home: {
      title: 'Home',
      empty: 'Continue watching, recent channels and favorites will appear here.',
    },
    live: { title: 'Live TV', empty: 'Live channels will appear here.' },
    movies: { title: 'Movies', empty: 'Movies will appear here.' },
    movieDetails: { title: 'Movie details', empty: 'Movie details will appear here.' },
    series: { title: 'Series', empty: 'Series will appear here.' },
    seriesDetails: { title: 'Series details', empty: 'Seasons and episodes will appear here.' },
    favorites: {
      title: 'Favorites',
      empty: 'Your favorite channels, movies and series will appear here.',
    },
    search: { title: 'Search', empty: 'Search channels, movies and series.' },
    settings: {
      title: 'Settings',
      empty: 'Settings will appear here.',
      myLists: 'My lists',
      myListsHint: 'Add, switch, refresh or remove your IPTV lists',
      privacy: 'Privacy and data',
      privacyHint: 'What is stored on this device',
    },
    sources: { title: 'My lists', empty: 'Your IPTV lists will appear here.' },
  },
  /** Labels for the route parameter shown by the placeholder screens. */
  categoryLabel: (id: string) => `Category: ${id}`,
  itemLabel: (id: string) => `Item: ${id}`,
  notFound: {
    title: 'Page not found',
    message: 'The page you are looking for does not exist.',
  },
  error: {
    message: 'This screen could not be displayed. Try again or go back to Home.',
  },
  goHome: 'Go to Home',
};
