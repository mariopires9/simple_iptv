import { describe, expect, it } from 'vitest';
import { createAppTheme } from './createAppTheme';
import { breakpoints, colors, focusRing, motion, touchTarget } from './tokens';

describe('createAppTheme', () => {
  it.each(['dark', 'light'] as const)('maps the %s tokens onto the MUI palette', (mode) => {
    const theme = createAppTheme(mode);
    const c = colors[mode];
    expect(theme.palette.mode).toBe(mode);
    expect(theme.palette.background.default).toBe(c.bg);
    expect(theme.palette.background.paper).toBe(c.surface1);
    expect(theme.palette.text.primary).toBe(c.text);
    expect(theme.palette.text.secondary).toBe(c.textMuted);
    expect(theme.palette.primary.main).toBe(c.accent);
    expect(theme.palette.primary.contrastText).toBe(c.onAccent);
    expect(theme.palette.error.main).toBe(c.danger);
    expect(theme.palette.warning.main).toBe(c.warning);
    expect(theme.palette.divider).toBe(c.outline);
    expect(theme.palette.tokens).toEqual(c);
  });

  it('uses tonal surfaces: no elevation shadows at any level', () => {
    const theme = createAppTheme('dark');
    expect(theme.shadows).toHaveLength(25);
    expect(new Set(theme.shadows)).toEqual(new Set(['none']));
  });

  it('disables the ripple globally', () => {
    const props = createAppTheme('dark').components?.MuiButtonBase?.defaultProps;
    expect(props?.disableRipple).toBe(true);
  });

  it('draws the focus ring from the tokens on keyboard focus', () => {
    const theme = createAppTheme('light');
    const root = theme.components?.MuiButtonBase?.styleOverrides?.root as Record<string, unknown>;
    expect(root['&.Mui-focusVisible']).toEqual({
      outline: `${focusRing.width}px solid ${colors.light.focusRing}`,
      outlineOffset: `${focusRing.offset}px`,
    });
  });

  it('gives icon buttons and menu items a ≥ 44 px touch target', () => {
    const theme = createAppTheme('dark');
    expect(theme.components?.MuiIconButton?.styleOverrides?.root).toMatchObject({
      minWidth: touchTarget,
      minHeight: touchTarget,
    });
    expect(theme.components?.MuiMenuItem?.styleOverrides?.root).toMatchObject({
      minHeight: touchTarget,
    });
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });

  it('uses the shell breakpoints (600 / 1200 px)', () => {
    const { values } = createAppTheme('dark').breakpoints;
    expect(values.sm).toBe(breakpoints.tablet);
    expect(values.lg).toBe(breakpoints.desktop);
  });

  it('uses the Inter Variable font with system fallbacks', () => {
    expect(createAppTheme('dark').typography.fontFamily).toMatch(/^"Inter Variable", system-ui/);
  });

  it('animates with the motion tokens by default', () => {
    const theme = createAppTheme('dark');
    const css = theme.transitions.create('opacity');
    expect(css).toContain(motion.easing);
    expect(theme.transitions.duration.standard).toBeGreaterThanOrEqual(120);
    expect(theme.transitions.duration.standard).toBeLessThanOrEqual(200);
  });

  // FND-03 AC5
  it('disables every transition when reduced motion is requested', () => {
    const theme = createAppTheme('dark', { reducedMotion: true });
    expect(theme.transitions.create(['opacity', 'transform'])).toBe('none');
    expect(Object.values(theme.transitions.duration).every((d) => d === 0)).toBe(true);
  });

  it('also disables CSS transitions/animations globally under prefers-reduced-motion', () => {
    const overrides = createAppTheme('dark').components?.MuiCssBaseline?.styleOverrides as Record<
      string,
      Record<string, Record<string, string>>
    >;
    const rule = overrides['@media (prefers-reduced-motion: reduce)']?.['*, *::before, *::after'];
    expect(rule?.transition).toBe('none !important');
    expect(rule?.animationDuration).toBe('0.01ms !important');
  });

  it('exposes a tabular-nums utility class', () => {
    const overrides = createAppTheme('dark').components?.MuiCssBaseline?.styleOverrides as Record<
      string,
      unknown
    >;
    expect(overrides['.tabular-nums']).toEqual({ fontVariantNumeric: 'tabular-nums' });
  });
});
