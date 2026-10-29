import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimPlayback,
  isPlaybackActive,
  resetPlaybackForTests,
  subscribePlayback,
} from './playback';

afterEach(() => resetPlaybackForTests());

describe('playback flag (PWA-03 AC2)', () => {
  it('is active while at least one player holds a claim; notifies on each transition', () => {
    const listener = vi.fn();
    subscribePlayback(listener);
    expect(isPlaybackActive()).toBe(false);

    const first = claimPlayback();
    const second = claimPlayback();
    expect(isPlaybackActive()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    first();
    first(); // idempotent: does not release the other claim
    expect(isPlaybackActive()).toBe(true);
    second();
    expect(isPlaybackActive()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlayback(listener);
    unsubscribe();
    claimPlayback();
    expect(listener).not.toHaveBeenCalled();
  });
});
