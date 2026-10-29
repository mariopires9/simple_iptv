// LIV-05: PlayerView's integration props — `overlay` (inside the region, i.e. the fullscreen
// element; its keys are not player shortcuts) and `onFinalError` (only errors the player gave up
// on; never the transient ones it reconnects from).
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackError } from '../types';
import { LIVE_RECONNECT_DELAYS_MS } from './PlayerView';
import { DESKTOP, LIVE, flush, key, renderPlayer } from './test-utils/renderPlayer';

afterEach(() => {
  vi.useRealTimers();
});

const networkError = () =>
  new PlaybackError({ kind: 'network', detail: 'fragLoadError', url: LIVE.url });

describe('PlayerView — overlay (LIV-05 AC2)', () => {
  it('renders the overlay inside the region, the element that goes fullscreen', async () => {
    const t = renderPlayer({
      descriptor: LIVE,
      platform: DESKTOP,
      overlay: <div role="dialog" aria-label="Channels" />,
    });
    await flush();
    const panel = screen.getByRole('dialog', { name: 'Channels' });
    expect(t.region()).toContainElement(panel);
    // The fullscreen request targets that same region.
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(t.region(), 'requestFullscreen', { value: request, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: /full ?screen/i }));
    expect(request).toHaveBeenCalled();
  });

  it('keys pressed inside the overlay are not player shortcuts', async () => {
    const onNext = vi.fn();
    const onClose = vi.fn();
    const onToggleChannelList = vi.fn();
    renderPlayer({
      descriptor: LIVE,
      onNext,
      onClose,
      onToggleChannelList,
      overlay: <button type="button">Row</button>,
    });
    await flush();
    const row = screen.getByRole('button', { name: 'Row' });
    for (const k of ['ArrowDown', 'Escape', 'l']) key(row, k);
    expect(onNext).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onToggleChannelList).not.toHaveBeenCalled();
    // Outside the overlay they still are.
    const t = screen.getByTestId('player-region');
    key(t, 'ArrowDown');
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerView — onFinalError (LIV-05 AC3)', () => {
  it('is silent during the automatic reconnects and reports only the error it gives up on', async () => {
    vi.useFakeTimers();
    const onFinalError = vi.fn();
    const t = renderPlayer({ descriptor: LIVE, onFinalError });
    await flush();
    for (const delay of LIVE_RECONNECT_DELAYS_MS) {
      act(() => t.controller.emit('error', networkError()));
      expect(onFinalError).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(delay));
      await flush();
    }
    const last = networkError();
    act(() => t.controller.emit('error', last));
    expect(onFinalError).toHaveBeenCalledTimes(1);
    expect(onFinalError).toHaveBeenCalledWith(last);
  });

  it('a non-transient error is final at once', async () => {
    const onFinalError = vi.fn();
    const t = renderPlayer({ descriptor: LIVE, onFinalError }, { router: true });
    await flush();
    const error = new PlaybackError({ kind: 'auth', status: 403, url: LIVE.url });
    act(() => t.controller.emit('error', error));
    expect(onFinalError).toHaveBeenCalledWith(error);
  });
});
