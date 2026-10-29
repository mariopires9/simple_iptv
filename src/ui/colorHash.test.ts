import { describe, expect, it } from 'vitest';
import { colorsForName } from './colorHash';
import { contrastRatio, MIN_TEXT_CONTRAST } from './theme/contrast';
import { avatarPalette } from './theme/tokens';

describe('colorsForName', () => {
  it('is stable for a name and spreads names over the palette', () => {
    const palette = avatarPalette.dark;
    expect(colorsForName('RTP 1', palette)).toBe(colorsForName('RTP 1', palette));
    const used = new Set(
      Array.from({ length: 50 }, (_, i) => colorsForName(`Channel ${i}`, palette)),
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

  it('rejects an empty palette', () => {
    expect(() => colorsForName('x', [])).toThrow(RangeError);
  });
});
