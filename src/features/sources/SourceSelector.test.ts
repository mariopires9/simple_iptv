// SRC-08: where the app goes after switching lists (items of the previous list are left).
import { describe, expect, it } from 'vitest';
import { pathAfterSwitch } from './SourceSelector';

describe('pathAfterSwitch', () => {
  it.each([
    ['/live/category/12', '', '/live'],
    ['/live', '?channel=a%3Alive%3A1', '/live'],
    ['/movies/42', '', '/movies'],
    ['/Series/category/5', '', '/series'],
  ])('%s%s → %s', (pathname, search, expected) => {
    expect(pathAfterSwitch(pathname, search)).toBe(expected);
  });

  it.each([['/'], ['/live'], ['/favorites'], ['/settings/sources'], ['/search']])(
    '%s stays',
    (pathname) => {
      expect(pathAfterSwitch(pathname, '')).toBeUndefined();
    },
  );
});
