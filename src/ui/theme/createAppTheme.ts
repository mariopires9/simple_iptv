// MUI theme built exclusively from the design tokens (docs/UX_UI.md §2, ADR-003).
import { createTheme, type Shadows, type Theme } from '@mui/material/styles';
import {
  breakpoints,
  colors,
  focusRing,
  fontFamily,
  labelLetterSpacing,
  motion,
  radii,
  touchTarget,
  typeScale,
  type ColorMode,
  type ColorTokens,
} from './tokens';

declare module '@mui/material/styles' {
  interface Palette {
    /** Raw design tokens for the active mode (surfaces, live, focus ring…). */
    tokens: ColorTokens;
  }
  interface PaletteOptions {
    tokens?: ColorTokens;
  }
}

export interface AppThemeOptions {
  /** `prefers-reduced-motion: reduce` — disables every transition (FND-03 AC5). */
  reducedMotion?: boolean;
}

/** Material elevation is replaced by tonal surfaces: every shadow level is `none`. */
const NO_SHADOWS = Array.from({ length: 25 }, () => 'none') as Shadows;

/** Global CSS that also covers non-MUI elements when the OS asks for reduced motion. */
const REDUCED_MOTION_CSS = {
  '@media (prefers-reduced-motion: reduce)': {
    '*, *::before, *::after': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transition: 'none !important',
      scrollBehavior: 'auto !important',
    },
  },
} as const;

export function createAppTheme(mode: ColorMode, options: AppThemeOptions = {}): Theme {
  const c = colors[mode];
  const reducedMotion = options.reducedMotion ?? false;
  const ring = {
    outline: `${focusRing.width}px solid ${c.focusRing}`,
    outlineOffset: `${focusRing.offset}px`,
  };

  return createTheme({
    palette: {
      mode,
      tokens: { ...c },
      background: { default: c.bg, paper: c.surface1 },
      text: { primary: c.text, secondary: c.textMuted, disabled: c.textMuted },
      primary: { main: c.accent, contrastText: c.onAccent },
      secondary: { main: c.accent, contrastText: c.onAccent },
      error: { main: c.danger },
      warning: { main: c.warning },
      divider: c.outline,
      action: {
        hover: c.surface3,
        selected: c.surface3,
        focus: c.surface3,
        active: c.text,
        disabledBackground: c.surface2,
        disabled: c.textMuted,
      },
    },
    breakpoints: {
      values: { xs: 0, sm: breakpoints.tablet, md: 900, lg: breakpoints.desktop, xl: 1536 },
    },
    // MUI keeps its 8 px unit; `theme.spacing(0.5)` = 4 px keeps everything on the 4 px grid.
    spacing: 8,
    shape: { borderRadius: radii.sm },
    shadows: NO_SHADOWS,
    typography: {
      fontFamily,
      h1: typeScale.display,
      h2: typeScale.title,
      h3: typeScale.heading,
      h4: typeScale.heading,
      h5: typeScale.heading,
      h6: typeScale.heading,
      subtitle1: typeScale.body,
      subtitle2: { ...typeScale.bodySm, fontWeight: 500 },
      body1: typeScale.body,
      body2: typeScale.bodySm,
      caption: typeScale.caption,
      overline: {
        ...typeScale.caption,
        textTransform: 'uppercase',
        letterSpacing: labelLetterSpacing,
      },
      button: { ...typeScale.bodySm, fontWeight: 600, textTransform: 'none' },
    },
    transitions: reducedMotion
      ? {
          create: () => 'none',
          duration: {
            shortest: 0,
            shorter: 0,
            short: 0,
            standard: 0,
            complex: 0,
            enteringScreen: 0,
            leavingScreen: 0,
          },
        }
      : {
          easing: {
            easeInOut: motion.easing,
            easeOut: motion.easing,
            easeIn: motion.easing,
            sharp: motion.easing,
          },
          duration: {
            shortest: motion.duration.short,
            shorter: motion.duration.short,
            short: motion.duration.medium,
            standard: motion.duration.long,
            complex: motion.duration.long,
            enteringScreen: motion.duration.long,
            leavingScreen: motion.duration.medium,
          },
        },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: c.bg, color: c.text },
          ':focus-visible': ring,
          '.tabular-nums': { fontVariantNumeric: 'tabular-nums' },
          ...REDUCED_MOTION_CSS,
        },
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: true, disableTouchRipple: true },
        styleOverrides: { root: { '&.Mui-focusVisible': ring } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'inherit' },
        styleOverrides: { root: { backgroundColor: c.surface2, color: c.text } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: touchTarget, borderRadius: radii.pill } },
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: touchTarget, minHeight: touchTarget } },
      },
      MuiMenuItem: {
        styleOverrides: { root: { minHeight: touchTarget } },
      },
      MuiMenu: {
        styleOverrides: { paper: { backgroundColor: c.surface2, borderRadius: radii.md } },
      },
      MuiBottomNavigation: {
        styleOverrides: { root: { backgroundColor: c.surface2, height: 'auto' } },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            minHeight: 56,
            minWidth: touchTarget,
            paddingInline: 4,
            color: c.textMuted,
            '&.Mui-selected': { color: c.accent },
          },
          label: {
            ...typeScale.caption,
            // pt-PT labels are longer: wrap instead of clipping (UX_UI §2.2).
            whiteSpace: 'normal',
            textAlign: 'center',
            '&.Mui-selected': { fontSize: typeScale.caption.fontSize },
          },
        },
      },
    },
  });
}
