import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/ui';
import { PlaybackError } from '../types';
import type { StreamDescriptor } from '../types';
import { BUFFERING_SPINNER_DELAY_MS, PlayerView, type PlayerViewProps } from './PlayerView';
import { AUTO_HIDE_DELAY_MS } from './useAutoHide';
import { fakeController, installFakeMedia, type FakeMedia } from './test-utils/fakeMedia';

const VOD: StreamDescriptor = {
  url: 'https://example.test/movie.mp4',
  kind: 'vod',
  container: 'mp4',
};
const LIVE: StreamDescriptor = {
  url: 'https://example.test/live.m3u8',
  kind: 'live',
  container: 'hls',
};
const theme = createAppTheme('dark');

/** Lets pending promises (controller.play → video.play) settle inside act(). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

function setup(props: Partial<PlayerViewProps> = {}, beforePlay?: (media: FakeMedia) => void) {
  const controller = fakeController();
  let media: FakeMedia | undefined;
  const factory = vi.fn((video: HTMLVideoElement) => {
    media = installFakeMedia(video);
    beforePlay?.(media);
    return controller;
  });
  const ui = (p: Partial<PlayerViewProps>) => (
    <ThemeProvider theme={theme}>
      <PlayerView descriptor={VOD} title="Big Movie" createController={factory} {...props} {...p} />
    </ThemeProvider>
  );
  const view = render(ui({}));
  const getMedia = () => {
    if (!media) throw new Error('media not installed');
    return media;
  };
  return {
    controller,
    factory,
    get media() {
      return getMedia();
    },
    region: () => screen.getByRole('region', { name: 'Player: Big Movie' }),
    controls: () => screen.getByTestId('player-controls'),
    rerender: (p: Partial<PlayerViewProps>) => view.rerender(ui(p)),
    unmount: view.unmount,
  };
}

const key = (target: Element, k: string) => fireEvent.keyDown(target, { key: k });

afterEach(() => {
  vi.useRealTimers();
});

describe('PlayerView — element and lifecycle', () => {
  it('renders a labelled, focused region with a bare inline <video> (no CORS, no native controls)', async () => {
    const t = setup();
    await flush();
    const region = t.region();
    expect(region).toHaveFocus();
    const video = region.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('playsinline');
    expect(video).not.toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('crossorigin');
  });

  it('loads the descriptor through the controller, then calls video.play()', async () => {
    const t = setup({ startAt: 42 });
    await flush();
    expect(t.factory).toHaveBeenCalledTimes(1);
    expect(t.controller.play).toHaveBeenCalledWith(VOD, { startAt: 42 });
    expect(t.media.play).toHaveBeenCalledTimes(1);
    expect(t.media.play.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.controller.play.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('reuses the same controller when the descriptor changes', async () => {
    const t = setup({ descriptor: LIVE, kind: 'live' });
    await flush();
    const next = { ...LIVE, url: 'https://example.test/other.m3u8' };
    t.rerender({ descriptor: next, kind: 'live' });
    await flush();
    expect(t.factory).toHaveBeenCalledTimes(1);
    expect(t.controller.play).toHaveBeenLastCalledWith(next, {});
  });

  it('does not reload when the parent passes an equal descriptor object', async () => {
    const t = setup();
    await flush();
    t.rerender({ descriptor: { ...VOD } });
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(1);
  });

  it('stops the controller and drops its listeners on unmount', async () => {
    const t = setup();
    await flush();
    expect(t.controller.listenerCount()).toBeGreaterThan(0);
    t.unmount();
    expect(t.controller.stop).toHaveBeenCalledTimes(1);
    expect(t.controller.listenerCount()).toBe(0);
  });
});

describe('PlayerView — live vs VOD controls', () => {
  it('live: shows the Live indicator and no seek bar without a DVR window', async () => {
    const t = setup({ descriptor: LIVE, title: 'Big Movie' });
    await flush();
    act(() => t.media.setSeekable([[0, 20]]));
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go live' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back 10 seconds' })).toBeNull();
  });

  it('live with a DVR window > 30 s: seek bar within the window and "Go live"', async () => {
    const t = setup({ descriptor: LIVE });
    await flush();
    act(() => {
      t.media.setSeekable([[100, 400]]);
      t.media.setTime(250);
    });
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider).toHaveAttribute('aria-valuemin', '100');
    expect(slider).toHaveAttribute('aria-valuemax', '400');
    expect(slider).toHaveAttribute('aria-valuetext', '2:30 of 5:00');
    fireEvent.click(screen.getByRole('button', { name: 'Go live' }));
    expect(t.media.seeks.at(-1)).toBe(400);
    // ← seeks back inside the window, clamped to its start.
    key(t.region(), 'ArrowLeft');
    expect(t.media.seeks.at(-1)).toBe(390);
    act(() => t.media.setTime(105));
    key(t.region(), 'ArrowLeft');
    expect(t.media.seeks.at(-1)).toBe(100);
  });

  it('VOD: progress bar with current/total time and ±10 s buttons, clamped', async () => {
    const t = setup();
    await flush();
    act(() => {
      t.media.setDuration(600);
      t.media.setTime(65);
    });
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider).toHaveAttribute('aria-valuetext', '1:05 of 10:00');
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(t.media.seeks.at(-1)).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(t.media.seeks.at(-1)).toBe(65);
    act(() => t.media.setTime(595));
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(t.media.seeks.at(-1)).toBe(600);
  });

  it('VOD: seeks through the slider (click/drag commits through the input)', async () => {
    const t = setup();
    await flush();
    act(() => t.media.setDuration(600));
    const slider = screen.getByRole('slider', { name: 'Seek' });
    fireEvent.change(slider, { target: { value: '300' } });
    expect(t.media.seeks.at(-1)).toBe(300);
  });

  it('VOD: pointer drag only seeks on release', async () => {
    const t = setup();
    await flush();
    act(() => t.media.setDuration(100));
    const slider = screen.getByRole('slider', { name: 'Seek' });
    const root = slider.closest('.MuiSlider-root') as HTMLElement;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 100,
      height: 10,
      right: 100,
      bottom: 10,
      toJSON: () => ({}),
    });
    // jsdom has no pointer capture.
    Object.assign(root, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => false,
    });
    const at = (clientX: number) => ({ pointerId: 1, button: 0, buttons: 1, clientX, clientY: 5 });
    fireEvent.pointerDown(root, at(40));
    expect(slider).toHaveAttribute('aria-valuenow', '40');
    for (const x of [45, 50, 60]) fireEvent.pointerMove(document, at(x));
    expect(t.media.seeks).toEqual([]);
    expect(slider).toHaveAttribute('aria-valuenow', '60');
    fireEvent.pointerUp(document, at(60));
    expect(t.media.seeks).toEqual([60]);
  });

  it('arrow keys on the slider move it by its own step (no extra ±10 s shortcut)', async () => {
    const t = setup();
    await flush();
    act(() => {
      t.media.setDuration(600);
      t.media.setTime(65);
    });
    key(screen.getByRole('slider', { name: 'Seek' }), 'ArrowRight');
    expect(t.media.seeks).toEqual([66]);
  });
});

describe('PlayerView — shortcuts', () => {
  it('Space and K toggle play/pause; M mutes; ←/→ seek ±10 s (VOD)', async () => {
    const t = setup();
    await flush();
    act(() => {
      t.media.setDuration(600);
      t.media.setTime(100);
    });
    expect(t.media.video.paused).toBe(false);
    key(t.region(), ' ');
    expect(t.media.pause).toHaveBeenCalledTimes(1);
    key(t.region(), 'k');
    expect(t.media.play).toHaveBeenCalledTimes(2);
    key(t.region(), 'K');
    expect(t.media.pause).toHaveBeenCalledTimes(2);
    key(t.region(), 'm');
    expect(t.media.video.muted).toBe(true);
    key(t.region(), 'M');
    expect(t.media.video.muted).toBe(false);
    key(t.region(), 'ArrowRight');
    expect(t.media.seeks.at(-1)).toBe(110);
    key(t.region(), 'ArrowLeft');
    expect(t.media.seeks.at(-1)).toBe(100);
  });

  it('F, ↑/↓, L and Esc call the callbacks (live)', async () => {
    const handlers = {
      onToggleFullscreen: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onToggleChannelList: vi.fn(),
      onClose: vi.fn(),
    };
    const t = setup({ descriptor: LIVE, ...handlers });
    await flush();
    key(t.region(), 'f');
    key(t.region(), 'ArrowUp');
    key(t.region(), 'ArrowDown');
    key(t.region(), 'l');
    key(t.region(), 'Escape');
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledTimes(1);
    // ←/→ do nothing on live without a DVR window.
    key(t.region(), 'ArrowLeft');
    expect(t.media.seeks).toEqual([]);
  });

  it('↑/↓ and L are live-only', async () => {
    const handlers = { onPrevious: vi.fn(), onNext: vi.fn(), onToggleChannelList: vi.fn() };
    const t = setup(handlers);
    await flush();
    key(t.region(), 'ArrowUp');
    key(t.region(), 'ArrowDown');
    key(t.region(), 'l');
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
  });

  it('Space on a focused button activates the button, not the play shortcut', async () => {
    const t = setup();
    await flush();
    const mute = screen.getByRole('button', { name: 'Mute' });
    key(mute, ' ');
    expect(t.media.pause).not.toHaveBeenCalled();
    // Other shortcuts still work from a button.
    key(mute, 'k');
    expect(t.media.pause).toHaveBeenCalledTimes(1);
  });

  it('keys outside the player region are ignored', async () => {
    const onClose = vi.fn();
    const t = setup({ onClose });
    await flush();
    const outside = document.createElement('input');
    document.body.append(outside);
    key(outside, 'Escape');
    key(outside, ' ');
    expect(onClose).not.toHaveBeenCalled();
    expect(t.media.pause).not.toHaveBeenCalled();
    outside.remove();
  });
});

describe('PlayerView — auto-hide', () => {
  it('hides after 3 s of playback without interaction and reappears on pointer/key', async () => {
    vi.useFakeTimers();
    const t = setup();
    await flush();
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS - 1));
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(1));
    expect(t.controls()).toHaveAttribute('data-visible', 'false');
    fireEvent.pointerMove(t.region());
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(t.controls()).toHaveAttribute('data-visible', 'false');
    key(t.region(), 'Shift');
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    fireEvent.pointerDown(t.region());
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
  });

  it('never hides while paused', async () => {
    vi.useFakeTimers();
    const t = setup();
    await flush();
    key(t.region(), 'k');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 3));
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
  });

  it('never hides while keyboard focus is inside the controls', async () => {
    vi.useFakeTimers();
    const t = setup();
    await flush();
    const mute = screen.getByRole('button', { name: 'Mute' });
    key(t.region(), 'Tab');
    act(() => mute.focus());
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 3));
    expect(t.controls()).toHaveAttribute('data-visible', 'true');
    // Focus leaves the controls: the countdown restarts.
    act(() => t.region().focus());
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(t.controls()).toHaveAttribute('data-visible', 'false');
  });
});

describe('PlayerView — buffering', () => {
  it('shows the spinner only after 500 ms of loading, and hides it once playing', async () => {
    vi.useFakeTimers();
    const controller = fakeController();
    // Loading never completes until the test says so.
    let finishLoad = () => {};
    controller.play.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    let media: FakeMedia | undefined;
    render(
      <ThemeProvider theme={theme}>
        <PlayerView
          descriptor={VOD}
          title="Big Movie"
          createController={(video) => {
            media = installFakeMedia(video);
            return controller;
          }}
        />
      </ThemeProvider>,
    );
    await flush();
    act(() => vi.advanceTimersByTime(BUFFERING_SPINNER_DELAY_MS - 1));
    expect(screen.queryByTestId('player-spinner')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('player-spinner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Buffering…');
    finishLoad();
    await flush();
    expect(media?.video.paused).toBe(false);
    expect(screen.queryByTestId('player-spinner')).toBeNull();
  });

  it('a short stall (< 500 ms) never shows the spinner; a long one does', async () => {
    vi.useFakeTimers();
    const t = setup();
    await flush();
    act(() => t.media.emit('waiting'));
    act(() => vi.advanceTimersByTime(BUFFERING_SPINNER_DELAY_MS - 100));
    act(() => t.media.emit('playing'));
    act(() => vi.advanceTimersByTime(BUFFERING_SPINNER_DELAY_MS));
    expect(screen.queryByTestId('player-spinner')).toBeNull();
    act(() => t.media.emit('waiting'));
    act(() => vi.advanceTimersByTime(BUFFERING_SPINNER_DELAY_MS));
    expect(screen.getByTestId('player-spinner')).toBeInTheDocument();
  });
});

describe('PlayerView — autoplay policy', () => {
  it('NotAllowedError → retries muted and offers Unmute', async () => {
    const t = setup({}, (media) => media.rejectPlay('NotAllowedError'));
    await flush();
    expect(t.media.play).toHaveBeenCalledTimes(2);
    expect(t.media.video.muted).toBe(true);
    expect(t.media.video.paused).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent(/without sound/);
    fireEvent.click(screen.getByTestId('player-unmute'));
    expect(t.media.video.muted).toBe(false);
    expect(screen.queryByTestId('player-unmute')).toBeNull();
  });

  it('the M shortcut also dismisses the Unmute button', async () => {
    const t = setup({}, (media) => media.rejectPlay('NotAllowedError'));
    await flush();
    expect(screen.getByTestId('player-unmute')).toBeInTheDocument();
    key(t.region(), 'm');
    expect(screen.queryByTestId('player-unmute')).toBeNull();
  });

  it('when even muted autoplay is refused, stays paused and unmuted with a Play button', async () => {
    const t = setup({}, (media) => media.rejectPlay('NotAllowedError', 'NotAllowedError'));
    await flush();
    expect(t.media.play).toHaveBeenCalledTimes(2);
    expect(t.media.video.muted).toBe(false);
    expect(t.media.video.paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByTestId('player-unmute')).toBeNull();
  });

  it('other play() rejections (AbortError) do not mute', async () => {
    const t = setup({}, (media) => media.rejectPlay('AbortError'));
    await flush();
    expect(t.media.play).toHaveBeenCalledTimes(1);
    expect(t.media.video.muted).toBe(false);
  });
});

describe('PlayerView — playback errors', () => {
  it('shows an error overlay and "Try again" loads the stream again', async () => {
    const t = setup();
    await flush();
    act(() =>
      t.controller.emit(
        'error',
        new PlaybackError({ kind: 'network', url: 'https://example.test/movie.mp4' }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Connection problem');
    // Only the top bar remains under the overlay.
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call video.play() when the load ended in an error', async () => {
    const controller = fakeController();
    controller.play.mockImplementation(async () => {
      controller.emit('error', new PlaybackError({ kind: 'unsupported-container' }));
    });
    let media: FakeMedia | undefined;
    render(
      <ThemeProvider theme={theme}>
        <PlayerView
          descriptor={VOD}
          title="Big Movie"
          createController={(video) => {
            media = installFakeMedia(video);
            return controller;
          }}
        />
      </ThemeProvider>,
    );
    await flush();
    expect(media?.play).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Format not supported');
  });
});

describe('PlayerView — announcements', () => {
  it('announces Playing, Paused, Muted and Sound on in a polite status region', async () => {
    const t = setup();
    await flush();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Playing');
    key(t.region(), 'k');
    expect(status).toHaveTextContent('Paused');
    key(t.region(), 'm');
    expect(status).toHaveTextContent('Muted');
    key(t.region(), 'm');
    expect(status).toHaveTextContent('Sound on');
  });

  it('every control button has an accessible name', async () => {
    setup({
      descriptor: LIVE,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onToggleChannelList: vi.fn(),
      onToggleFullscreen: vi.fn(),
      onClose: vi.fn(),
    });
    await flush();
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(
      expect.arrayContaining([
        'Close player',
        'Previous channel',
        'Pause',
        'Next channel',
        'Mute',
        'Channel list',
        'Fullscreen',
      ]),
    );
    expect(names.every((n) => n !== null && n !== '')).toBe(true);
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
  });
});
