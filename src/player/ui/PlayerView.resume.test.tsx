// VOD-03 AC4: a resume position the stream cannot seek to → "Starting from the beginning" notice;
// VOD-03/SER-03: the <video> element is handed to the parent (progress saving, next episode).
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESUME_NOTICE_MS } from './PlayerView';
import { flush, renderPlayer } from './test-utils/renderPlayer';

afterEach(() => {
  vi.useRealTimers();
});

describe('PlayerView — resume-unsupported (VOD-03 AC4)', () => {
  it('shows a dismissible status notice', async () => {
    const t = renderPlayer({ startAt: 754 });
    await flush();
    act(() => t.controller.emit('notice', { type: 'resume-unsupported', startAt: 754 }));
    const notice = screen.getByTestId('player-resume-unsupported');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent('Starting from the beginning');
    // Not blocking: the controls are still there.
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('player-resume-unsupported')).toBeNull();
  });

  it('hides itself after a few seconds', async () => {
    vi.useFakeTimers();
    const t = renderPlayer({ startAt: 120 });
    await flush();
    act(() => t.controller.emit('notice', { type: 'resume-unsupported', startAt: 120 }));
    expect(screen.getByTestId('player-resume-unsupported')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(RESUME_NOTICE_MS - 1));
    expect(screen.getByTestId('player-resume-unsupported')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('player-resume-unsupported')).toBeNull();
  });

  it('a new stream starts without the previous notice', async () => {
    const t = renderPlayer({ startAt: 120 });
    await flush();
    act(() => t.controller.emit('notice', { type: 'resume-unsupported', startAt: 120 }));
    t.rerender({
      descriptor: { url: 'https://example.test/b.mp4', kind: 'vod', container: 'mp4' },
    });
    await flush();
    expect(screen.queryByTestId('player-resume-unsupported')).toBeNull();
  });
});

describe('PlayerView — onVideoElement', () => {
  it('reports the element on mount and null on unmount', async () => {
    const onVideoElement = vi.fn();
    const t = renderPlayer({ onVideoElement });
    await flush();
    expect(onVideoElement).toHaveBeenLastCalledWith(t.media.video);
    t.unmount();
    expect(onVideoElement).toHaveBeenLastCalledWith(null);
  });
});
