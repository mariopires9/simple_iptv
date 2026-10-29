// TEC-01 review: the `player` strings load with the player UI chunk (`@/player/ui`), not with the
// screens that may open it; the exported PlayerView waits for them.
import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlaybackActive, subscribePlayback } from '@/core/session';
import {
  activeLocale,
  applyPendingLocale,
  ensureMessages,
  hasPendingLocale,
  installLanguagePreference,
  isMessagesLoaded,
  loadAllMessages,
  resetLanguagePreferenceForTests,
  setLocale,
  unloadMessagesForTests,
} from '@/i18n';
import { createAppTheme } from '@/ui';
import { PlayerView } from './index';
import { PlayerView as InnerPlayerView } from './PlayerView';
import { fakeController, installFakeMedia } from './test-utils/fakeMedia';

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>();
  return { ...actual, ensureMessages: vi.fn(actual.ensureMessages) };
});

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <p>failed: {this.state.error.message}</p> : this.props.children;
  }
}

function renderPlayer() {
  render(
    <ThemeProvider theme={createAppTheme('dark')}>
      <Boundary>
        <PlayerView
          descriptor={{ url: 'https://example.test/movie.mp4', kind: 'vod', container: 'mp4' }}
          title="Big Movie"
          createController={(video) => {
            installFakeMedia(video);
            return fakeController();
          }}
          platform={{ fullscreenApi: false, pip: false, mobile: false }}
        />
      </Boundary>
    </ThemeProvider>,
  );
}

afterEach(async () => {
  cleanup();
  vi.mocked(ensureMessages).mockClear();
  vi.restoreAllMocks();
  resetLanguagePreferenceForTests();
  await setLocale('en');
  await loadAllMessages();
});

describe('@/player/ui PlayerView (TEC-01)', () => {
  it('renders once the player strings have loaded', async () => {
    unloadMessagesForTests();
    renderPlayer();
    expect(screen.queryByRole('region')).toBeNull();
    expect(await screen.findByRole('region', { name: /Big Movie/ })).toBeInTheDocument();
    expect(isMessagesLoaded('player')).toBe(true);
    expect(ensureMessages).toHaveBeenCalledWith('player');
  });

  it('renders at once when the strings are already there', () => {
    renderPlayer();
    expect(screen.getByRole('region', { name: /Big Movie/ })).toBeInTheDocument();
  });

  it('marks playback as active while mounted, so app updates wait (PWA-03 AC2)', () => {
    expect(isPlaybackActive()).toBe(false);
    renderPlayer();
    expect(isPlaybackActive()).toBe(true);
    cleanup();
    expect(isPlaybackActive()).toBe(false);
  });

  it('one claim per player: the inner view does not claim on its own (TEC-03)', () => {
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <InnerPlayerView
          descriptor={{ url: 'https://example.test/movie.mp4', kind: 'vod', container: 'mp4' }}
          title="Big Movie"
          createController={(video) => {
            installFakeMedia(video);
            return fakeController();
          }}
          platform={{ fullscreenApi: false, pip: false, mobile: false }}
        />
      </ThemeProvider>,
    );
    expect(screen.getByRole('region', { name: /Big Movie/ })).toBeInTheDocument();
    expect(isPlaybackActive()).toBe(false);
  });

  it('holds the claim while the strings load: no app update, no browser locale switch (TEC-03)', async () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    const uninstall = installLanguagePreference(isPlaybackActive, subscribePlayback);
    unloadMessagesForTests();
    vi.mocked(ensureMessages).mockReturnValueOnce(new Promise<void>(() => undefined));
    renderPlayer();
    expect(screen.queryByRole('region')).toBeNull(); // still loading the strings
    // PWA-03 (src/app/pwa): an update waits while this is true.
    expect(isPlaybackActive()).toBe(true);

    languages.mockReturnValue(['pt-PT']);
    window.dispatchEvent(new Event('languagechange'));
    applyPendingLocale(); // a navigation meanwhile
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activeLocale()).toBe('en');
    expect(hasPendingLocale()).toBe(true);

    cleanup(); // the player is gone: the switch happens
    expect(isPlaybackActive()).toBe(false);
    await vi.waitFor(() => expect(activeLocale()).toBe('pt-PT'));
    uninstall();
  });

  it('a failed load reaches the error boundary instead of rendering without strings', async () => {
    unloadMessagesForTests();
    vi.mocked(ensureMessages).mockRejectedValueOnce(new Error('strings unavailable'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPlayer();
    expect(await screen.findByText('failed: strings unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    // The failed player released its claim (its effects are cleaned up after the fallback commits).
    await vi.waitFor(() => expect(isPlaybackActive()).toBe(false));
    quiet.mockRestore();
  });
});
