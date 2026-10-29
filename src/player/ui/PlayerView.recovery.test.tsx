// PLY-04: live reconnects with backoff, error overlay actions and the "no sound" banner.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackError } from '../types';
import { AUDIO_CHECK_DELAY_MS } from './audioCheck';
import { DIAGNOSTICS_PATH, LIVE_RECONNECT_DELAYS_MS } from './PlayerView';
import { LIVE, VOD, flush, renderPlayer } from './test-utils/renderPlayer';

afterEach(() => {
  vi.useRealTimers();
});

const networkError = () =>
  new PlaybackError({ kind: 'network', detail: 'fragLoadError', url: LIVE.url });

/** Fails the current load with `error` (after controller.play resolved, like an engine). */
function fail(t: ReturnType<typeof renderPlayer>, error: PlaybackError) {
  act(() => t.controller.emit('error', error));
}

async function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
  await flush();
}

describe('PlayerView — live reconnects (AC1)', () => {
  it('3 reconnects after 1 s, 2 s and 4 s, then the error overlay', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE, title: 'Channel', onNext: vi.fn() });
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(1);

    for (const [i, delay] of LIVE_RECONNECT_DELAYS_MS.entries()) {
      fail(t, networkError());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByTestId('player-reconnecting')).toHaveTextContent(
        `Reconnecting… (attempt ${i + 1} of 3)`,
      );
      await advance(delay - 1);
      expect(t.controller.play).toHaveBeenCalledTimes(i + 1);
      await advance(1);
      expect(t.controller.play).toHaveBeenCalledTimes(i + 2);
      expect(t.controller.play).toHaveBeenLastCalledWith(LIVE, {});
    }

    fail(t, networkError());
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.queryByTestId('player-reconnecting')).toBeNull();
    await advance(10_000);
    expect(t.controller.play).toHaveBeenCalledTimes(4);
  });

  it('a reconnect that plays resets the backoff', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    fail(t, networkError());
    await advance(1000);
    fail(t, networkError());
    await advance(2000);
    expect(t.controller.play).toHaveBeenCalledTimes(3);
    act(() => t.media.emit('playing'));
    expect(screen.queryByTestId('player-reconnecting')).toBeNull();
    fail(t, networkError());
    expect(screen.getByTestId('player-reconnecting')).toHaveTextContent('attempt 1 of 3');
    await advance(1000);
    expect(t.controller.play).toHaveBeenCalledTimes(4);
  });

  it('"Try again" after the overlay starts a fresh set of reconnects', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    for (const delay of LIVE_RECONNECT_DELAYS_MS) {
      fail(t, networkError());
      await advance(delay);
    }
    fail(t, networkError());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(5);
    fail(t, networkError());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('player-reconnecting')).toHaveTextContent('attempt 1 of 3');
  });

  it('only network errors on live are retried', async () => {
    vi.useFakeTimers();
    const vod = renderPlayer({ descriptor: VOD });
    await flush();
    fail(vod, new PlaybackError({ kind: 'network' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Connection problem');
    vod.unmount();

    for (const kind of ['blocked', 'auth', 'unsupported-codec', 'decode'] as const) {
      const live = renderPlayer({ descriptor: LIVE }, { router: true });
      await flush();
      fail(live, new PlaybackError({ kind }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await advance(5000);
      expect(live.controller.play).toHaveBeenCalledTimes(1);
      live.unmount();
    }
  });

  it('zapping during the delay cancels the pending reconnect', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    fail(t, networkError());
    const next = { ...LIVE, url: 'https://example.test/other.m3u8' };
    t.rerender({ descriptor: next });
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('player-reconnecting')).toBeNull();
    await advance(10_000);
    expect(t.controller.play).toHaveBeenCalledTimes(2);
    expect(t.controller.play).toHaveBeenLastCalledWith(next, {});
  });

  it('unmounting during the delay leaves no timer behind', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    const baseline = vi.getTimerCount();
    fail(t, networkError());
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    t.unmount();
    expect(t.controller.listenerCount()).toBe(0);
    await advance(10_000);
    expect(t.controller.play).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerView — error overlay actions (AC5, AC6)', () => {
  it('live: "Try again" and "Next channel"', async () => {
    const onNext = vi.fn();
    const t = renderPlayer({ descriptor: LIVE, onNext });
    await flush();
    fail(t, new PlaybackError({ kind: 'decode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next channel' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(2);
  });

  it('VOD (or live without a next channel): only "Try again"', async () => {
    const t = renderPlayer({ descriptor: VOD, onNext: vi.fn() });
    await flush();
    fail(t, new PlaybackError({ kind: 'decode' }));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next channel' })).toBeNull();
  });

  it('blocked: HTTPS/CORS message with a link to the diagnostics', async () => {
    const t = renderPlayer({ descriptor: LIVE }, { router: true });
    await flush();
    fail(t, new PlaybackError({ kind: 'blocked', hint: 'cors', url: LIVE.url }));
    expect(screen.getByRole('alert')).toHaveTextContent('Stream blocked by the browser');
    const link = screen.getByRole('link', { name: 'Connection diagnostics' });
    expect(link).toHaveAttribute('href', DIAGNOSTICS_PATH);
  });

  it('blocked by mixed content: HTTPS message, also with the diagnostics link', async () => {
    const t = renderPlayer({ descriptor: LIVE }, { router: true });
    await flush();
    fail(t, new PlaybackError({ kind: 'blocked', hint: 'mixed-content' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Insecure stream address');
    expect(screen.getByRole('link', { name: 'Connection diagnostics' })).toBeInTheDocument();
  });

  it('other errors: no diagnostics link', async () => {
    const t = renderPlayer({ descriptor: LIVE }, { router: true });
    await flush();
    fail(t, new PlaybackError({ kind: 'decode' }));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('AC4: 403 → account/connections message', async () => {
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    fail(t, new PlaybackError({ kind: 'auth', status: 403 }));
    expect(screen.getByRole('alert')).toHaveTextContent(/simultaneous connections/);
  });

  it('AC8: entry with required headers + 403 → provider restriction', async () => {
    const t = renderPlayer({ descriptor: LIVE, requiredHeaders: true });
    await flush();
    fail(t, new PlaybackError({ kind: 'auth', status: 403 }));
    expect(screen.getByRole('alert')).toHaveTextContent('Playback restricted by the provider');
  });

  it('AC2: codec error names the codec', async () => {
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    fail(t, new PlaybackError({ kind: 'unsupported-codec', codec: 'hev1.1.6.L93.B0' }));
    expect(screen.getByRole('alert')).toHaveTextContent('HEVC (H.265)');
  });
});

describe('PlayerView — no sound (AC3)', () => {
  it('engine notice: non-blocking banner naming the codec, dismissible', async () => {
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    act(() => t.controller.emit('notice', { type: 'audio-unsupported', codec: 'ac-3' }));
    const banner = screen.getByTestId('player-no-audio');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent(
      'No sound: audio AC-3 (Dolby Digital) is not supported in this browser.',
    );
    // Not blocking: the controls are still there.
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
  });

  it('decoder counters: video decoded but no audio after a few seconds of playback', async () => {
    vi.useFakeTimers();
    const t = renderPlayer(
      { descriptor: LIVE },
      {
        beforePlay: (media) => {
          media.readyState = 4;
          Object.defineProperties(media.video, {
            webkitAudioDecodedByteCount: { configurable: true, value: 0 },
            webkitVideoDecodedByteCount: { configurable: true, value: 50_000 },
          });
        },
      },
    );
    await flush();
    await advance(AUDIO_CHECK_DELAY_MS - 1);
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
    await advance(1);
    expect(screen.getByTestId('player-no-audio')).toHaveTextContent(
      'No sound: this browser may not support the audio of this stream.',
    );
    expect(t.region()).toBeInTheDocument();
  });

  it('no banner when audio is decoded, when paused, or without counters', async () => {
    vi.useFakeTimers();
    const counters = (audio: number) => ({
      beforePlay: (media: { readyState: number; video: HTMLVideoElement }) => {
        media.readyState = 4;
        Object.defineProperties(media.video, {
          webkitAudioDecodedByteCount: { configurable: true, value: audio },
          webkitVideoDecodedByteCount: { configurable: true, value: 50_000 },
        });
      },
    });
    const withAudio = renderPlayer({ descriptor: LIVE }, counters(4096));
    await flush();
    await advance(AUDIO_CHECK_DELAY_MS * 2);
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
    withAudio.unmount();

    const paused = renderPlayer({ descriptor: LIVE }, counters(0));
    await flush();
    act(() => paused.media.video.pause());
    await advance(AUDIO_CHECK_DELAY_MS * 2);
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
    paused.unmount();

    renderPlayer({ descriptor: LIVE }, { beforePlay: (media) => (media.readyState = 4) });
    await flush();
    await advance(AUDIO_CHECK_DELAY_MS * 2);
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
  });

  it('a new stream starts without the previous banner', async () => {
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    act(() => t.controller.emit('notice', { type: 'audio-unsupported' }));
    expect(screen.getByTestId('player-no-audio')).toBeInTheDocument();
    t.rerender({ descriptor: { ...LIVE, url: 'https://example.test/b.m3u8' } });
    await flush();
    expect(screen.queryByTestId('player-no-audio')).toBeNull();
  });
});
