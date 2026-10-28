import { describe, expect, it } from 'vitest';
import { contrastRatio, MIN_TEXT_CONTRAST } from '@/ui/theme/contrast';
import { avatarPalette } from '@/ui/theme/tokens';
import { avatarColorsFor, initialsOf, isLoadableLogo } from './ChannelAvatar';

describe('isLoadableLogo', () => {
  it.each([
    ['https://logos.example/a.png', 'https:', true],
    ['http://logos.example/a.png', 'http:', true],
    // Mixed content: an http logo on an https page is blocked → initials.
    ['http://logos.example/a.png', 'https:', false],
    ['data:image/png;base64,AAAA', 'https:', true],
    ['data:text/html,hi', 'https:', false],
    ['javascript:alert(1)', 'https:', false],
    ['not a url', 'https:', false],
    ['', 'https:', false],
    [undefined, 'https:', false],
  ])('%s on %s → %s', (url, protocol, expected) => {
    expect(isLoadableLogo(url, protocol)).toBe(expected);
  });
});

describe('initialsOf', () => {
  it.each([
    ['RTP 1', 'R1'],
    ['sport tv', 'ST'],
    ['Ácção Canal Três', 'ÁC'],
    ['|PT| News', 'PN'],
    ['***', '?'],
  ])('%s → %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe('avatarColorsFor', () => {
  it('is stable for a name and spreads names over the palette', () => {
    const palette = avatarPalette.dark;
    expect(avatarColorsFor('RTP 1', palette)).toBe(avatarColorsFor('RTP 1', palette));
    const used = new Set(
      Array.from({ length: 50 }, (_, i) => avatarColorsFor(`Channel ${i}`, palette)),
    );
    expect(used.size).toBeGreaterThan(4);
  });

  it('every palette pair meets 4.5:1 in both modes', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const { bg, fg } of avatarPalette[mode]) {
        expect(contrastRatio(bg, fg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    }
  });
});
