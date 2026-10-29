// TEC-03: Live route ids and paths shared by Live, Home/Favorites and Search.
import { describe, expect, it } from 'vitest';
import {
  LIVE_RECENT_LIMIT,
  LIVE_VIRTUAL_CATEGORY_IDS,
  liveCategoryPath,
  liveChannelPath,
} from './live';

describe('Live routes', () => {
  it('keeps the virtual category ids apart from provider ids', () => {
    expect(LIVE_VIRTUAL_CATEGORY_IDS).toEqual({
      favorites: '~favorites',
      recent: '~recent',
      all: '~all',
    });
    expect(LIVE_RECENT_LIMIT).toBe(30); // FAV-02 AC1
  });

  it('encodes the category id', () => {
    expect(liveCategoryPath('~recent')).toBe('/live/category/~recent');
    expect(liveCategoryPath('a/b c')).toBe('/live/category/a%2Fb%20c');
  });

  it('selects the channel in its category, or in "All" without one', () => {
    expect(liveChannelPath('12', 'src:live:7')).toBe('/live/category/12?channel=src%3Alive%3A7');
    expect(liveChannelPath(undefined, 'k&1')).toBe('/live/category/~all?channel=k%261');
  });
});
