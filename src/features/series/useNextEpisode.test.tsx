// SER-03 AC2/AC3: the "Next episode in 10 s" countdown — at ≤ 20 s remaining or on `ended`,
// Cancel, re-arming after a seek back, nothing without a next episode.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_SEC, OFFER_REMAINING_SEC, useNextEpisode } from './useNextEpisode';

function fakeVideo(duration: number) {
  const video = document.createElement('video');
  const state = { time: 0, ended: false, paused: false };
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => state.time });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => state.ended });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => state.paused });
  return {
    video,
    at(time: number) {
      act(() => {
        state.time = time;
        video.dispatchEvent(new Event('timeupdate'));
      });
    },
    seekTo(time: number) {
      act(() => {
        state.time = time;
        state.ended = false;
        video.dispatchEvent(new Event('seeked'));
      });
    },
    pause(paused = true) {
      act(() => {
        state.paused = paused;
        video.dispatchEvent(new Event(paused ? 'pause' : 'play'));
      });
    },
    end() {
      act(() => {
        state.time = duration;
        state.ended = true;
        state.paused = true;
        video.dispatchEvent(new Event('ended'));
      });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(hasNext = true, duration = 1200) {
  const media = fakeVideo(duration);
  const onAdvance = vi.fn();
  const hook = renderHook(() => useNextEpisode(media.video, hasNext, onAdvance));
  return { media, onAdvance, hook };
}

describe('useNextEpisode', () => {
  it(`starts at ${OFFER_REMAINING_SEC} s remaining and moves on after ${COUNTDOWN_SEC} s`, () => {
    const { media, onAdvance, hook } = setup();
    media.at(1100);
    expect(hook.result.current.phase).toEqual({ kind: 'idle' });
    media.at(1200 - OFFER_REMAINING_SEC);
    expect(hook.result.current.phase).toEqual({ kind: 'counting', seconds: 10 });
    act(() => vi.advanceTimersByTime(3000));
    expect(hook.result.current.phase).toEqual({ kind: 'counting', seconds: 7 });
    act(() => vi.advanceTimersByTime(6000));
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('`ended` starts it when the last seconds were never reported', () => {
    const { media, onAdvance, hook } = setup(true, Number.NaN);
    media.end();
    expect(hook.result.current.phase.kind).toBe('counting');
    act(() => vi.advanceTimersByTime(COUNTDOWN_SEC * 1000));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('Cancel stops it for this episode (even at the end)', () => {
    const { media, onAdvance, hook } = setup();
    media.at(1190);
    act(() => hook.result.current.cancel());
    expect(hook.result.current.phase).toEqual({ kind: 'cancelled' });
    media.at(1195);
    media.end();
    act(() => vi.advanceTimersByTime(60_000));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('seeking back before the last seconds re-arms it', () => {
    const { media, hook } = setup();
    media.at(1190);
    act(() => hook.result.current.cancel());
    media.seekTo(600);
    expect(hook.result.current.phase).toEqual({ kind: 'idle' });
    media.at(1185);
    expect(hook.result.current.phase.kind).toBe('counting');
  });

  it('holds while the video is paused, resumes when it plays again (review #4)', () => {
    const { media, onAdvance, hook } = setup();
    media.at(1190);
    act(() => vi.advanceTimersByTime(3000));
    media.pause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(hook.result.current.phase).toEqual({ kind: 'counting', seconds: 7 });
    expect(onAdvance).not.toHaveBeenCalled();
    media.pause(false);
    act(() => vi.advanceTimersByTime(7000));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('Play now moves on at once', () => {
    const { media, onAdvance, hook } = setup();
    media.at(1190);
    act(() => hook.result.current.playNow());
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('the last episode offers nothing (SER-03 AC3)', () => {
    const { media, onAdvance, hook } = setup(false);
    media.at(1195);
    media.end();
    act(() => vi.advanceTimersByTime(60_000));
    expect(hook.result.current.phase).toEqual({ kind: 'idle' });
    expect(onAdvance).not.toHaveBeenCalled();
  });
});
