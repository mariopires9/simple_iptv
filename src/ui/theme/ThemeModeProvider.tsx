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
// `@/core/db` (Dexie) is only imported as types here and loaded on demand (`loadSettingsRepo`),
// so it stays out of the initial chunk (ADR-003). The first paint uses the localStorage mirror.
import type { THEMES, Theme as ThemePreference } from '@/core/db';
import { log } from '@/core/log';
import { createAppTheme } from './createAppTheme';
import { REDUCED_MOTION_QUERY, type ColorMode } from './tokens';

export type { ThemePreference };

/**
 * Theme preferences in display order. A copy of core/db's `THEMES` (importing the value would
 * pull Dexie into the initial chunk); the type below fails to compile if they ever diverge, and
 * ThemeModeProvider.test.tsx checks the order.
 */
export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const satisfies typeof THEMES;

export const PREFERS_LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * localStorage mirror of the preference, read synchronously so the first paint already uses the
 * right theme (IndexedDB is async). Per-viewer convenience only: IndexedDB is the source of truth.
 */
export const THEME_CACHE_KEY = 'simple-iptv:theme';

const MEDIA_OPTIONS = { noSsr: true } as const;

export interface ThemeModeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually rendered. */
  mode: ColorMode;
  reducedMotion: boolean;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

async function loadSettingsRepo() {
  return (await import('@/core/db')).settingsRepo;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

function readCachedPreference(): ThemePreference | undefined {
  try {
    const value = globalThis.localStorage?.getItem(THEME_CACHE_KEY);
    return isThemePreference(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedPreference(value: ThemePreference | undefined): void {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(THEME_CACHE_KEY);
    else globalThis.localStorage?.setItem(THEME_CACHE_KEY, value);
  } catch {
    // Storage blocked (private mode, quota): the cache is optional.
  }
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
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readCachedPreference() ?? 'system',
  );
  // Once the user picks a theme, a late read of the stored value must not override it.
  const userChose = useRef(false);
  const systemPrefersLight = useMediaQuery(PREFERS_LIGHT_QUERY, MEDIA_OPTIONS);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, MEDIA_OPTIONS);

  useEffect(() => {
    let active = true;
    loadSettingsRepo()
      .then((settingsRepo) => settingsRepo.get('theme'))
      .then(
        (stored) => {
          if (!active || userChose.current) return;
          // Reconcile with the source of truth: no stored value means "System".
          const next = isThemePreference(stored) ? stored : 'system';
          setPreferenceState(next);
          writeCachedPreference(next === 'system' ? undefined : next);
        },
        (error: unknown) => {
          // DB unavailable: keep the cached choice (or "System") and keep working.
          log.warn('Theme preference could not be read', { error: String(error) });
        },
      );
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    userChose.current = true;
    setPreferenceState(next);
    writeCachedPreference(next === 'system' ? undefined : next);
    loadSettingsRepo()
      .then((settingsRepo) => settingsRepo.set('theme', next))
      .catch((error: unknown) => {
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
