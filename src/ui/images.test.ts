import { describe, expect, it } from 'vitest';
import { isLoadableImage } from './images';

describe('isLoadableImage', () => {
  it.each([
    ['https://logos.example/a.png', 'https:', true],
    ['http://logos.example/a.png', 'http:', true],
    // Mixed content: an http image on an https page is blocked → fallback.
    ['http://logos.example/a.png', 'https:', false],
    ['data:image/png;base64,AAAA', 'https:', true],
    ['data:text/html,hi', 'https:', false],
    ['javascript:alert(1)', 'https:', false],
    ['not a url', 'https:', false],
    ['', 'https:', false],
    ['   ', 'http:', false],
    [undefined, 'https:', false],
  ])('%s on %s → %s', (url, protocol, expected) => {
    expect(isLoadableImage(url, protocol)).toBe(expected);
  });
});
