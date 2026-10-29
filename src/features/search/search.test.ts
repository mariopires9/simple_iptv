// SCH-02: recent searches (validation, order, limit), result targets and the query rules.
import { describe, expect, it } from 'vitest';
import { resultPath } from './paths';
import { isSearchableQuery as isSearchable } from '@/core/db';
import {
  MAX_RECENT_LENGTH,
  MAX_RECENT_SEARCHES,
  cleanQuery,
  parseRecentSearches,
  withRecentSearch,
} from './recentSearches';

describe('recent searches', () => {
  it('puts the latest first, without duplicates (case-insensitive), at most 10', () => {
    let list: string[] = [];
    for (let i = 1; i <= 12; i++) list = withRecentSearch(list, `query ${i}`);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]).toBe('query 12');
    expect(list.at(-1)).toBe('query 3');
    expect(withRecentSearch(list, '  QUERY   5 ')).toEqual([
      'QUERY 5',
      ...list.filter((q) => q !== 'query 5'),
    ]);
    expect(withRecentSearch(list, '   ')).toEqual(list);
  });

  it('validates the stored value (untrusted)', () => {
    expect(parseRecentSearches(undefined)).toEqual([]);
    expect(parseRecentSearches('news')).toEqual([]);
    expect(parseRecentSearches({ 0: 'a' })).toEqual([]);
    expect(parseRecentSearches(['news', 1, null, '', ' ', 'News', 'drama'])).toEqual([
      'news',
      'drama',
    ]);
    const many = Array.from({ length: 30 }, (_, i) => `q${i}`);
    expect(parseRecentSearches(many)).toHaveLength(MAX_RECENT_SEARCHES);
    expect(parseRecentSearches(['x'.repeat(500)])[0]).toHaveLength(MAX_RECENT_LENGTH);
  });

  it('cleans whitespace', () => {
    expect(cleanQuery('  sport \n tv  ')).toBe('sport tv');
  });
});

describe('result targets (AC3)', () => {
  it('a channel plays in its Live category; without one, in "All"', () => {
    expect(resultPath({ type: 'live', key: 's:live:7', externalId: '7', categoryId: 'a b' })).toBe(
      '/live/category/a%20b?channel=s%3Alive%3A7',
    );
    expect(resultPath({ type: 'live', key: 's:live:7', externalId: '7' })).toBe(
      '/live/category/~all?channel=s%3Alive%3A7',
    );
  });

  it('a movie or a series opens its details', () => {
    expect(resultPath({ type: 'movie', key: 's:movie:x/1', externalId: 'x/1' })).toBe(
      '/movies/x%2F1',
    );
    expect(resultPath({ type: 'series', key: 's:series:9', externalId: '9' })).toBe('/series/9');
  });
});

describe('isSearchable', () => {
  it('needs 2 letters or digits', () => {
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable('a !')).toBe(false);
    expect(isSearchable('é')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
    expect(isSearchable('1 2')).toBe(true);
  });
});
