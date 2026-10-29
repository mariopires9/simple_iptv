// PWA-04: offline, a network failure does not use up the live reconnects; the overlay says "No
// connection" (cause captured when it failed) and the stream is retried once when it returns.
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import { PlaybackError } from '../types';
import { LIVE_RECONNECT_DELAYS_MS } from './PlayerView';
import { LIVE, VOD, flush, renderPlayer } from './test-utils/renderPlayer';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const networkError = () =>
  new PlaybackError({ kind: 'network', detail: 'fragLoadError', url: LIVE.url });

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

async function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
  await flush();
}

describe('PlayerView offline (PWA-04)', () => {
  it('live: no reconnect attempts while offline, one retry when the connection returns', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: LIVE });
    await flush();
    setOnline(false);
    act(() => t.controller.emit('error', networkError()));

    expect(screen.queryByTestId('player-reconnecting')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(en.player.errors.offline.title);
    await advance(LIVE_RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0) + 10_000);
    expect(t.controller.play).toHaveBeenCalledTimes(1);

    setOnline(true);
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();

    // The reconnects were not used up: a later drop online still gets all of them.
    act(() => t.controller.emit('error', networkError()));
    expect(screen.getByTestId('player-reconnecting')).toHaveTextContent('attempt 1 of 3');
    await advance(LIVE_RECONNECT_DELAYS_MS[0]!);
    expect(t.controller.play).toHaveBeenCalledTimes(3);
  });

  it('the overlay keeps the cause it failed with (not re-derived when going online)', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: VOD });
    await flush();
    // Failed while ONLINE: a plain network error…
    act(() => t.controller.emit('error', networkError()));
    expect(screen.getByRole('alert')).toHaveTextContent(en.player.errors.network.title);
    // …going offline afterwards does not rewrite it, nor retry it on return.
    setOnline(false);
    expect(screen.getByRole('alert')).toHaveTextContent(en.player.errors.network.title);
    setOnline(true);
    await advance(5_000);
    expect(t.controller.play).toHaveBeenCalledTimes(1);
  });

  it('retries only once per return: failing offline again waits for the next one', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: VOD });
    await flush();
    setOnline(false);
    act(() => t.controller.emit('error', networkError()));
    setOnline(true);
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(2);

    setOnline(false);
    act(() => t.controller.emit('error', networkError()));
    await advance(10_000);
    expect(t.controller.play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent(en.player.errors.offline.title);
    setOnline(true);
    await flush();
    expect(t.controller.play).toHaveBeenCalledTimes(3);
  });

  it('a codec error while offline keeps its own message and is not auto-retried', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: VOD });
    await flush();
    setOnline(false);
    act(() =>
      t.controller.emit('error', new PlaybackError({ kind: 'unsupported-codec', codec: 'ac-3' })),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      en.player.errors['unsupported-codec'].title,
    );
    setOnline(true);
    await advance(5_000);
    expect(t.controller.play).toHaveBeenCalledTimes(1);
  });
});
