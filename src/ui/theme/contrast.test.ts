import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  contrastRatio,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  relativeLuminance,
} from './contrast';
import { colors, type ColorMode } from './tokens';

describe('WCAG helpers', () => {
  it('matches the reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#FFFFFF', '#777777')).toBe(contrastRatio('#777777', '#FFFFFF'));
  });

  it('rejects malformed colors', () => {
    expect(() => relativeLuminance('#fff')).toThrow();
  });
});

// FND-03 AC2: every text/background pair ≥ 4.5:1 and every UI/background pair ≥ 3:1, both themes.
describe.each(['dark', 'light'] as const satisfies readonly ColorMode[])('%s tokens', (mode) => {
  const palette = colors[mode];

  it.each(CONTRAST_PAIRS.map((p) => [`${p.kind} ${p.fg} on ${p.bg}`, p] as const))(
    '%s',
    (_name, pair) => {
      const ratio = contrastRatio(palette[pair.fg], palette[pair.bg]);
      const min = pair.kind === 'text' ? MIN_TEXT_CONTRAST : MIN_UI_CONTRAST;
      expect(ratio).toBeGreaterThanOrEqual(min);
    },
  );
});
