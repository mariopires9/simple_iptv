// VOD-03 AC1: the position is saved every 10 s while playing, on pause, on exit (pagehide,
// visibilitychange, closing the player) and on `ended` (completed).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_INTERVAL_MS, type ProgressSnapshot } from './resume';
import { useProgressSaver } from './useProgressSaver';

interface Media {
  video: HTMLVideoElement;
  set(time: number): void;
  play(): void;
  pause(): void;
  end(): void;
}

function fakeMedia(duration = 3000): Media {
  const video = document.createElement('video');
  const state = { time: 0, paused: true, ended: false };
  const define = (name: string, get: () => unknown) =>
    Object.defineProperty(video, name, { configurable: true, get });
  define('currentTime', () => state.time);
  define('duration', () => duration);
  define('paused', () => state.paused);
  define('ended', () => state.ended);
  const emit = (type: string) => video.dispatchEvent(new Event(type));
  return {
    video,
    set(time) {
      state.time = time;
      emit('timeupdate');
    },
    play() {
      state.paused = false;
      state.ended = false;
      emit('play');
    },
    pause() {
      state.paused = true;
      emit('pause');
    },
    end() {
      state.time = duration;
      state.paused = true;
      state.ended = true;
      emit('pause');
      emit('ended');
    },
  };
}

let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

function setup(media = fakeMedia()) {
  const saved: ProgressSnapshot[] = [];
  const save = vi.fn((s: ProgressSnapshot) => saved.push(s));
  const hook = renderHook(({ video }) => useProgressSaver(video, save), {
    initialProps: { video: media.video as HTMLVideoElement | null },
  });
  return { media, saved, save, hook };
}

describe('useProgressSaver', () => {
  it('every 10 s while playing, never while paused', () => {
    const { media, saved } = setup();
    media.play();
    media.set(12);
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS));
    expect(saved).toEqual([{ positionSec: 12, durationSec: 3000, completed: false }]);
    media.set(22.7);
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS));
    expect(saved.at(-1)).toEqual({ positionSec: 22, durationSec: 3000, completed: false });
    // Same position: not written twice.
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS));
    expect(saved).toHaveLength(2);
    media.pause();
    expect(saved).toHaveLength(2); // same position as the last save
    media.set(30);
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS * 3));
    expect(saved).toHaveLength(2);
  });

  it('on pause', () => {
    const { media, saved } = setup();
    media.play();
    media.set(95);
    media.pause();
    expect(saved).toEqual([{ positionSec: 95, durationSec: 3000, completed: false }]);
  });

  it('on pagehide and when the page is hidden', () => {
    const { media, saved } = setup();
    media.play();
    media.set(40);
    window.dispatchEvent(new Event('pagehide'));
    expect(saved.at(-1)?.positionSec).toBe(40);
    media.set(50);
    document.dispatchEvent(new Event('visibilitychange')); // still visible: nothing
    expect(saved).toHaveLength(1);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saved.at(-1)?.positionSec).toBe(50);
  });

  it('when the player closes (unmount), with the last known position', () => {
    const { media, saved, hook } = setup();
    media.play();
    media.set(321);
    // The engine empties the element before the hook's cleanup runs.
    media.set(0);
    hook.unmount();
    expect(saved).toEqual([{ positionSec: 321, durationSec: 3000, completed: false }]);
  });

  it('`ended` saves it as completed, once', () => {
    const { media, saved, hook } = setup();
    media.play();
    media.set(2990);
    media.end();
    expect(saved).toEqual([{ positionSec: 3000, durationSec: 3000, completed: true }]);
    hook.unmount();
    expect(saved).toHaveLength(1);
  });

  it('nothing before playback really started (resume seek in flight)', () => {
    const { media, saved, hook } = setup();
    media.play();
    media.set(0.4);
    media.pause();
    window.dispatchEvent(new Event('pagehide'));
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS));
    hook.unmount();
    expect(saved).toEqual([]);
  });

  it('stops listening when the element goes', () => {
    const { media, saved, hook } = setup();
    media.play();
    media.set(70);
    hook.rerender({ video: null });
    expect(saved).toHaveLength(1); // the exit save
    media.set(80);
    media.pause();
    window.dispatchEvent(new Event('pagehide'));
    act(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS));
    expect(saved).toHaveLength(1);
  });
});
