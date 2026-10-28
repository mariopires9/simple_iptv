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

/** 4 px grid. */
export const spacingUnit = 4;
export const space = [4, 8, 12, 16, 24, 32, 48, 64] as const;
/** Page margins per viewport (px). */
export const pageMargin = { mobile: 16, tablet: 24, desktop: 32 } as const;

/** Corner radii (px). */
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Minimum touch target (px). */
export const touchTarget = 44;

/** Viewport breakpoints (px): < tablet → bottom nav; tablet–desktop → rail; ≥ desktop → expanded rail. */
export const breakpoints = { tablet: 600, desktop: 1200 } as const;

/** Navigation chrome sizes (px). */
export const navSize = { rail: 88, expandedRail: 240, topBar: 56, bottomNav: 64 } as const;

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
