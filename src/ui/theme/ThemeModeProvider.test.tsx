import 'fake-indexeddb/auto';
import { useTheme } from '@mui/material/styles';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { installMatchMedia } from '../test-utils/matchMedia';
import { colors } from './tokens';
import { ThemeModeProvider, useThemeMode, type ThemePreference } from './ThemeModeProvider';

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
  await wipeAll();
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
