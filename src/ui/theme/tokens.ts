// Design tokens — docs/UX_UI.md §2. The ONLY place in the app where literal colors live
// (FND-03 AC1). Everything else reads them through the MUI theme.

export type ColorMode = 'dark' | 'light';

export interface ColorTokens {
  /** App background. */
  bg: string;
  /** Cards, lists. */
  surface1: string;
  /** Bars, elevated panels. */
  surface2: string;
  /** Hover / selected. */
  surface3: string;
  /** Dividers and decorative separators only (not a component boundary — see contrast test). */
  outline: string;
  /** Primary text. */
  text: string;
  /** Metadata / secondary text. */
  textMuted: string;
  /** Primary action, selection, focus. */
  accent: string;
  /** Text on `accent`. */
  onAccent: string;
  /** "Live" indicator, EPG progress. */
  live: string;
  /** Account expiring, warnings. */
  warning: string;
  /** Errors, destructive actions. */
  danger: string;
  /** Keyboard focus ring (always visible). */
  focusRing: string;
}

export const colors: Readonly<Record<ColorMode, Readonly<ColorTokens>>> = {
  dark: {
    bg: '#0B0E13',
    surface1: '#12161D',
    surface2: '#1A2029',
    surface3: '#232B36',
    outline: '#2E3845',
    text: '#E8ECF1',
    textMuted: '#9AA6B4',
    accent: '#3DDCB0',
    onAccent: '#04130E',
    live: '#FF5A5F',
    warning: '#F5B544',
    danger: '#FF6B6B',
    focusRing: '#3DDCB0',
  },
  light: {
    bg: '#F6F7F9',
    surface1: '#FFFFFF',
    surface2: '#EEF1F4',
    surface3: '#E2E6EB',
    outline: '#CBD2DA',
    text: '#11151B',
    textMuted: '#56606C',
    accent: '#087258', // doc: #0A7A5E (4.23:1 on surface3)
    onAccent: '#FFFFFF',
    live: '#BF2A2F', // doc: #D62F35 (3.88:1 on surface3)
    warning: '#8A5A00', // doc: #9A6400 (3.99:1 on surface3)
    danger: '#BE2626', // doc: #C62828 (4.48:1 on surface3)
    focusRing: '#087258', // follows accent
  },
};

/** Focus ring geometry (px). */
export const focusRing = { width: 2, offset: 2 } as const;

/**
 * MUI spacing unit (px). The design uses a 4 px grid (4, 8, 12, 16, 24, 32, 48, 64); MUI keeps
 * its 8 px base so its components keep their designed paddings, and `theme.spacing(0.5)` = 4 px.
 */
export const spacingBase = 8;
/** Page margins per viewport (px). */
export const pageMargin = { mobile: 16, tablet: 24, desktop: 32 } as const;

/** Corner radii (px). */
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Minimum touch target (px). */
export const touchTarget = 44;

/** Viewport breakpoints (px): < tablet → bottom nav; tablet–desktop → rail; ≥ desktop → expanded rail. */
export const breakpoints = { tablet: 600, desktop: 1200 } as const;

/** Navigation chrome sizes (px). */
export const navSize = { rail: 88, expandedRail: 240, topBar: 56 } as const;

export const fontFamily =
  '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Type scale (rem, base 16). */
export const typeScale = {
  display: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2 },
  title: { fontSize: '1.375rem', fontWeight: 650, lineHeight: 1.3 },
  heading: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 },
  body: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.5 },
  bodySm: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.45 },
  caption: { fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.4 },
} as const;

/** Uppercase label tracking (caption labels only). */
export const labelLetterSpacing = '0.04em';

/** Motion: 120–200 ms, standard easing. Disabled under `prefers-reduced-motion`. */
export const motion = {
  easing: 'cubic-bezier(.2,0,0,1)',
  duration: { short: 120, medium: 160, long: 200 },
} as const;

/**
 * The single source for "the user asked for reduced motion": used by `ThemeModeProvider`
 * (`useMediaQuery`) for the MUI theme and as the `@media` condition of the global CSS fallback.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** A background/foreground pair for name-derived avatars (initials). */
export interface AvatarColors {
  bg: string;
  fg: string;
}

/**
 * Palette for initials avatars when a logo is missing or fails (LIV-01): the entry is picked
 * from a hash of the name, so a channel always gets the same color. Every pair meets 4.5:1.
 */
export const avatarPalette: Readonly<Record<ColorMode, readonly Readonly<AvatarColors>[]>> = {
  dark: [
    { bg: '#1F4E5F', fg: '#E8ECF1' },
    { bg: '#5B3A6E', fg: '#E8ECF1' },
    { bg: '#6E3B3B', fg: '#E8ECF1' },
    { bg: '#3B5E3B', fg: '#E8ECF1' },
    { bg: '#6A4E1F', fg: '#E8ECF1' },
    { bg: '#2F4A7A', fg: '#E8ECF1' },
    { bg: '#5E2F4F', fg: '#E8ECF1' },
    { bg: '#2F5A5A', fg: '#E8ECF1' },
  ],
  light: [
    { bg: '#CFE8EF', fg: '#11151B' },
    { bg: '#E6D7F0', fg: '#11151B' },
    { bg: '#F3D6D6', fg: '#11151B' },
    { bg: '#D5ECD5', fg: '#11151B' },
    { bg: '#F2E3C4', fg: '#11151B' },
    { bg: '#D3E0F5', fg: '#11151B' },
    { bg: '#EFD3E4', fg: '#11151B' },
    { bg: '#D2E9E6', fg: '#11151B' },
  ],
};
