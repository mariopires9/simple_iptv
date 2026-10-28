import 'fake-indexeddb/auto';
import { useTheme } from '@mui/material/styles';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { installMatchMedia } from '../test-utils/matchMedia';
import { colors } from './tokens';
import {
  THEME_CACHE_KEY,
  ThemeModeProvider,
  useThemeMode,
  type ThemePreference,
} from './ThemeModeProvider';

function Probe() {
  const { preference, mode, reducedMotion, setPreference } = useThemeMode();
  const theme = useTheme();
  return (
    <div>
      <output aria-label="preference">{preference}</output>
      <output aria-label="mode">{mode}</output>
      <output aria-label="background">{theme.palette.background.default}</output>
      <output aria-label="reduced">{String(reducedMotion)}</output>
      <output aria-label="transition">{theme.transitions.create('opacity')}</output>
      {(['system', 'dark', 'light'] as ThemePreference[]).map((p) => (
        <button key={p} type="button" onClick={() => setPreference(p)}>
          {p}
        </button>
      ))}
    </div>
  );
}

const renderProbe = () =>
  render(
    <ThemeModeProvider>
      <Probe />
    </ThemeModeProvider>,
  );

const out = (name: string) => screen.getByRole('status', { name }).textContent;

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  media = installMatchMedia({ width: 1024 });
});

afterEach(async () => {
  media.restore();
  vi.restoreAllMocks();
  localStorage.clear();
  await wipeAll();
});

describe('ThemeModeProvider — localStorage mirror (no flash on cold start)', () => {
  it('renders the cached theme on the very first render', () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');
    // The IndexedDB read never settles during this test: only the cache can explain "light".
    vi.spyOn(settingsRepo, 'get').mockReturnValue(new Promise(() => undefined));
    renderProbe();
    expect(out('preference')).toBe('light');
    expect(out('mode')).toBe('light');
    expect(out('background')).toBe(colors.light.bg);
  });

  it('IndexedDB is the source of truth: a stale cache is reconciled when it loads', async () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');
    await settingsRepo.set('theme', 'dark');
    renderProbe();
    expect(out('mode')).toBe('light');
    await waitFor(() => expect(out('preference')).toBe('dark'));
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('dark');
  });

  it('no stored preference means System, and the stale cache is dropped', async () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');
    renderProbe();
    await waitFor(() => expect(out('preference')).toBe('system'));
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });

  it('mirrors every choice to the cache', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBe('light');
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(localStorage.getItem(THEME_CACHE_KEY)).toBeNull();
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const user = userEvent.setup();
    renderProbe();
    expect(out('preference')).toBe('system');
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(out('mode')).toBe('light');
    await waitFor(async () => expect(await settingsRepo.get('theme')).toBe('light'));
  });

  it('keeps the cached choice when the database is unavailable', async () => {
    localStorage.setItem(THEME_CACHE_KEY, 'light');
    vi.spyOn(settingsRepo, 'get').mockRejectedValue(new Error('IndexedDB unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderProbe();
    await waitFor(() => expect(settingsRepo.get).toHaveBeenCalled());
    expect(out('mode')).toBe('light');
  });
});

describe('ThemeModeProvider', () => {
  it('defaults to System, resolved to dark when the system has no preference', async () => {
    renderProbe();
    expect(out('preference')).toBe('system');
    expect(out('mode')).toBe('dark');
    expect(out('background')).toBe(colors.dark.bg);
    // Let the (empty) stored-preference read settle.
    await act(() => settingsRepo.get('theme'));
    expect(out('preference')).toBe('system');
  });

  it('System follows prefers-color-scheme live, without reload', async () => {
    media.set({ colorScheme: 'light' });
    renderProbe();
    expect(out('mode')).toBe('light');
    act(() => media.set({ colorScheme: 'dark' }));
    expect(out('mode')).toBe('dark');
    act(() => media.set({ colorScheme: 'light' }));
    expect(out('mode')).toBe('light');
  });

  it('switches theme without reload and persists the choice (AC4)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderProbe();

    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(out('mode')).toBe('light');
    expect(out('background')).toBe(colors.light.bg);
    await waitFor(async () => expect(await settingsRepo.get('theme')).toBe('light'));

    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(out('mode')).toBe('dark');
    await waitFor(async () => expect(await settingsRepo.get('theme')).toBe('dark'));

    // A new session (fresh mount) restores the stored preference.
    unmount();
    media.set({ colorScheme: 'light' });
    renderProbe();
    await waitFor(() => expect(out('preference')).toBe('dark'));
    expect(out('mode')).toBe('dark');
  });

  it('a user choice made before the stored value loads is not overridden by it', async () => {
    await settingsRepo.set('theme', 'light');
    let resolveRead: (value: ThemePreference) => void = () => undefined;
    vi.spyOn(settingsRepo, 'get').mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('button', { name: 'dark' }));
    await act(async () => resolveRead('light'));
    expect(out('preference')).toBe('dark');
  });

  it('falls back to System and keeps working when the database is unavailable', async () => {
    vi.spyOn(settingsRepo, 'get').mockRejectedValue(new Error('IndexedDB unavailable'));
    vi.spyOn(settingsRepo, 'set').mockRejectedValue(new Error('IndexedDB unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderProbe();
    await waitFor(() => expect(settingsRepo.get).toHaveBeenCalled());
    expect(out('preference')).toBe('system');
    expect(out('mode')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(out('mode')).toBe('light');
  });

  // FND-03 AC5
  it('disables transitions when prefers-reduced-motion is set, and reacts to changes', () => {
    media.set({ reducedMotion: true });
    renderProbe();
    expect(out('reduced')).toBe('true');
    expect(out('transition')).toBe('none');

    act(() => media.set({ reducedMotion: false }));
    expect(out('reduced')).toBe('false');
    expect(out('transition')).not.toBe('none');
  });

  it('useThemeMode throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ThemeModeProvider/);
  });
});
