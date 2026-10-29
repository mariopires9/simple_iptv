// Page cache of the movie grid (VOD-01): the grid's order is a list of keys (see sortIndex.ts);
// full movie rows are read from IndexedDB a page at a time, by key, through the shared catalogue
// cache (`@/ui/catalog/pageCache`: viewport paging, bounded memory, pinned active cell).
import { catalogRepo, type Movie } from '@/core/db';
import { CatalogPageCache, keyedPageSource } from '@/ui/catalog/pageCache';

export const PAGE_SIZE = 120;
export const MAX_PAGES = 6;

export type LoadMovies = (keys: readonly string[]) => Promise<Movie[]>;

const loadByKeys: LoadMovies = (keys) => catalogRepo.getMany('movie', keys);

export class MoviePageCache extends CatalogPageCache<Movie> {
  constructor(
    keys: readonly string[],
    load: LoadMovies = loadByKeys,
    pageSize = PAGE_SIZE,
    maxPages = MAX_PAGES,
  ) {
    super(keyedPageSource(keys, load), pageSize, maxPages);
  }
}
