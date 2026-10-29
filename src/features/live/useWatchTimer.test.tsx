import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_AFTER_MS, useWatchTimer } from './useWatchTimer';

function Harness({ itemKey, onWatched }: { itemKey: string | undefined; onWatched: () => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useWatchTimer(el, itemKey, onWatched);
  return (
    <div ref={setEl}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- test double */}
      <video data-testid="video" />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

const fire = (el: Element, type: string) => act(() => void el.dispatchEvent(new Event(type)));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useWatchTimer', () => {
  it('counts only playing time (stalls pause it) and fires once per key', () => {
    const onWatched = vi.fn();
    const view = render(<Harness itemKey="a" onWatched={onWatched} />);
    const video = view.getByTestId('video');
    fire(video, 'playing');
    advance(2_000);
    fire(video, 'waiting');
    advance(60_000);
    fire(video, 'playing');
    advance(RECENT_AFTER_MS - 2_001);
    expect(onWatched).not.toHaveBeenCalled();
    advance(1);
    expect(onWatched).toHaveBeenCalledExactlyOnceWith('a');
    fire(video, 'pause');
    fire(video, 'playing');
    advance(RECENT_AFTER_MS * 3);
    expect(onWatched).toHaveBeenCalledTimes(1);

    // A new key starts over.
    view.rerender(<Harness itemKey="b" onWatched={onWatched} />);
    fire(video, 'playing');
    advance(RECENT_AFTER_MS);
    expect(onWatched).toHaveBeenLastCalledWith('b');
  });

  it('`stalled` mid-play does not stop the count (normal MSE playback)', () => {
    const onWatched = vi.fn();
    const view = render(<Harness itemKey="a" onWatched={onWatched} />);
    const video = view.getByTestId('video');
    fire(video, 'playing');
    advance(2_000);
    fire(video, 'stalled');
    advance(RECENT_AFTER_MS - 2_000);
    expect(onWatched).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('resumes on timeupdate progress after a wait, without a new `playing`', () => {
    const onWatched = vi.fn();
    const view = render(<Harness itemKey="a" onWatched={onWatched} />);
    const video = view.getByTestId('video') as HTMLVideoElement;
    let time = 0;
    let paused = false;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time });
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    fire(video, 'playing');
    advance(1_000);
    fire(video, 'waiting');
    advance(30_000);
    // Same position: still buffering.
    fire(video, 'timeupdate');
    time = 1;
    fire(video, 'timeupdate');
    advance(RECENT_AFTER_MS - 1_001);
    expect(onWatched).not.toHaveBeenCalled();
    advance(1);
    expect(onWatched).toHaveBeenCalledOnce();

    // Paused: a timeupdate does not count.
    view.rerender(<Harness itemKey="b" onWatched={onWatched} />);
    paused = true;
    time = 2;
    fire(video, 'timeupdate');
    advance(RECENT_AFTER_MS * 2);
    expect(onWatched).toHaveBeenCalledOnce();
  });

  it('does nothing without a key, and stops counting when the key changes', () => {
    const onWatched = vi.fn();
    const view = render(<Harness itemKey={undefined} onWatched={onWatched} />);
    const video = view.getByTestId('video');
    fire(video, 'playing');
    advance(RECENT_AFTER_MS * 2);
    view.rerender(<Harness itemKey="a" onWatched={onWatched} />);
    fire(video, 'playing');
    advance(RECENT_AFTER_MS - 1);
    view.rerender(<Harness itemKey={undefined} onWatched={onWatched} />);
    advance(RECENT_AFTER_MS);
    expect(onWatched).not.toHaveBeenCalled();
  });
});
