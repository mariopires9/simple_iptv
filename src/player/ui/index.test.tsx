// TEC-01 review: the `player` strings load with the player UI chunk (`@/player/ui`), not with the
// screens that may open it; the exported PlayerView waits for them.
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureMessages, isMessagesLoaded, loadAllMessages, unloadMessagesForTests } from '@/i18n';
import { createAppTheme } from '@/ui';
import { PlayerView } from './index';
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
  vi.mocked(ensureMessages).mockClear();
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

  it('a failed load reaches the error boundary instead of rendering without strings', async () => {
    unloadMessagesForTests();
    vi.mocked(ensureMessages).mockRejectedValueOnce(new Error('strings unavailable'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPlayer();
    expect(await screen.findByText('failed: strings unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    quiet.mockRestore();
  });
});
