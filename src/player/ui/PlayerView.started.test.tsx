// PLY-07: PlayerView reports the candidate that actually started (Live learns its format), and
// a live stream that started and then stalls without an error fails its candidate.
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamDescriptor } from '../types';
import { LIVE_STALL_TIMEOUT_MS } from './PlayerView';
import type { FakeController } from './test-utils/fakeMedia';
import { VOD, flush, renderPlayer } from './test-utils/renderPlayer';

describe('PlayerView — live stall watchdog (PLY-07)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
    await flush();
  }

  it('a started live stream without progress for LIVE_STALL_TIMEOUT_MS reports a stall', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ descriptor: DESCRIPTOR, kind: 'live' });
    await flush();
    act(() => t.media.setTime(1));
    await advance(LIVE_STALL_TIMEOUT_MS - 1000);
    // Progress re-arms the watchdog.
    act(() => t.media.setTime(2));
    await advance(LIVE_STALL_TIMEOUT_MS - 1000);
    expect(t.controller.reportStall).not.toHaveBeenCalled();
    await advance(1000);
    expect(t.controller.reportStall).toHaveBeenCalledTimes(1);
  });

  it('a paused live stream is not stalled; VOD is not watched', async () => {
    vi.useFakeTimers();
    const live = renderPlayer({ descriptor: DESCRIPTOR, kind: 'live' });
    await flush();
    act(() => live.media.video.pause());
    await advance(LIVE_STALL_TIMEOUT_MS * 2);
    expect(live.controller.reportStall).not.toHaveBeenCalled();
    live.unmount();

    const vod = renderPlayer({ descriptor: VOD });
    await flush();
    await advance(LIVE_STALL_TIMEOUT_MS * 2);
    expect(vod.controller.reportStall).not.toHaveBeenCalled();
  });
});

const TS: StreamDescriptor = { url: 'https://example.test/1.ts', kind: 'live', container: 'ts' };
const HLS: StreamDescriptor = {
  url: 'https://example.test/1.m3u8',
  kind: 'live',
  container: 'hls',
};
const DESCRIPTOR: StreamDescriptor = { ...TS, fallbacks: [HLS] };

describe('PlayerView — onStarted (PLY-07)', () => {
  it('reports the fallback that reached its first frame, once', async () => {
    const onStarted = vi.fn();
    const t = renderPlayer(
      { descriptor: DESCRIPTOR, kind: 'live', onStarted },
      {
        onController: (c: FakeController) => {
          // The first candidate fails inside play(); the fallback is then loaded.
          c.play.mockImplementationOnce(async () => {
            c.emit('attempt', { engine: 'mpegts', descriptor: TS, attempt: 0 });
            c.emit('attempt', { engine: 'hls', descriptor: HLS, attempt: 1 });
          });
        },
      },
    );
    await flush();
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(HLS);
    act(() => t.media.emit('canplay'));
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it('nothing is reported without a first frame', async () => {
    const onStarted = vi.fn();
    renderPlayer(
      { descriptor: DESCRIPTOR, kind: 'live', onStarted },
      {
        onController: (c: FakeController) => {
          c.play.mockImplementationOnce(async () => {
            c.emit('attempt', { engine: 'mpegts', descriptor: TS, attempt: 0 });
          });
        },
        // Autoplay refused (also muted): no `playing`, and readyState stays 0.
        beforePlay: (media) => media.rejectPlay('NotAllowedError', 'NotAllowedError'),
      },
    );
    await flush();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
