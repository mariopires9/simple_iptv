// Theme mode (System / Dark / Light) + MUI theme provider (FND-03 AC4, AC5).
import '@fontsource-variable/inter';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { settingsRepo, type Theme as ThemePreference } from '@/core/db';
import { log } from '@/core/log';
import { createAppTheme } from './createAppTheme';
import type { ColorMode } from './tokens';

export type { ThemePreference };

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

export const PREFERS_LIGHT_QUERY = '(prefers-color-scheme: light)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface ThemeModeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually rendered. */
  mode: ColorMode;
  reducedMotion: boolean;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Resolves the rendered mode. "System" follows `prefers-color-scheme`; dark is the default
 * whenever the system does not explicitly ask for light (or cannot be resolved).
 */
export function resolveMode(preference: ThemePreference, systemPrefersLight: boolean): ColorMode {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  // Once the user picks a theme, a late read of the stored value must not override it.
  const userChose = useRef(false);
  const systemPrefersLight = useMediaQuery(PREFERS_LIGHT_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  useEffect(() => {
    let active = true;
    settingsRepo.get('theme').then(
      (stored) => {
        if (active && !userChose.current && isThemePreference(stored)) setPreferenceState(stored);
      },
      (error: unknown) => {
        // DB unavailable: keep "System" and keep working (FND-05 AC5 shows the error elsewhere).
        log.warn('Theme preference could not be read; using System', { error: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    userChose.current = true;
    setPreferenceState(next);
    settingsRepo.set('theme', next).catch((error: unknown) => {
      log.warn('Theme preference could not be saved', { error: String(error) });
    });
  }, []);

  const mode = resolveMode(preference, systemPrefersLight);
  const theme = useMemo(() => createAppTheme(mode, { reducedMotion }), [mode, reducedMotion]);
  const value = useMemo<ThemeModeContextValue>(
    () => ({ preference, mode, reducedMotion, setPreference }),
    [preference, mode, reducedMotion, setPreference],
  );

  return (
    <ThemeModeContext value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ThemeModeContext>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const value = useContext(ThemeModeContext);
  if (!value) throw new Error('useThemeMode must be used inside <ThemeModeProvider>');
  return value;
}
