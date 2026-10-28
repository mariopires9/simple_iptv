// WCAG 2.x contrast helpers and the token pairs that must meet them (FND-03 AC2).
import type { ColorTokens } from './tokens';

/** Relative luminance of a `#RRGGBB` color (WCAG 2.x definition). */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected a #RRGGBB color, got "${hex}"`);
  const n = Number.parseInt(match[1], 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const c = ((n >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two `#RRGGBB` colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_UI_CONTRAST = 3;

export type ColorToken = keyof ColorTokens;

export interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  kind: 'text' | 'ui';
}

const BACKGROUNDS: readonly ColorToken[] = ['bg', 'surface1', 'surface2', 'surface3'];

/** Tokens rendered as text (or text-sized icons) on any background/surface. */
const TEXT_TOKENS: readonly ColorToken[] = [
  'text',
  'textMuted',
  'accent',
  'live',
  'warning',
  'danger',
];

/** Tokens used as non-text UI (selection indicators, focus ring) on any background/surface. */
const UI_TOKENS: readonly ColorToken[] = ['accent', 'focusRing'];

/**
 * Every pair the UI may render. `outline` is intentionally absent: it is reserved for decorative
 * dividers (WCAG 1.4.11 exempts them); component boundaries must use a token from this list.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT_TOKENS.flatMap((fg) => BACKGROUNDS.map((bg) => ({ fg, bg, kind: 'text' as const }))),
  { fg: 'onAccent', bg: 'accent', kind: 'text' },
  ...UI_TOKENS.flatMap((fg) => BACKGROUNDS.map((bg) => ({ fg, bg, kind: 'ui' as const }))),
];
