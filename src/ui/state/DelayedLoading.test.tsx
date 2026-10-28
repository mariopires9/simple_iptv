import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedLoading, LOADING_DELAY_MS } from './DelayedLoading';
import { ChannelListSkeleton } from './Skeletons';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// UX-02 AC2: loading under 300 ms never flashes.
describe('DelayedLoading', () => {
  it('renders nothing for the first 300 ms, then the children', () => {
    expect(LOADING_DELAY_MS).toBe(300);
    const { container } = render(
      <DelayedLoading>
        <ChannelListSkeleton />
      </DelayedLoading>,
    );
    expect(container).toBeEmptyDOMElement();
    advance(299);
    expect(container).toBeEmptyDOMElement();
    advance(1);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('a load that finishes within 300 ms never shows anything', () => {
    const rendered: string[] = [];
    const { container, rerender } = render(
      <DelayedLoading loading>
        <span>spinner</span>
      </DelayedLoading>,
    );
    const observer = new MutationObserver(() => rendered.push(container.innerHTML));
    observer.observe(container, { childList: true, subtree: true });
    advance(250);
    rerender(
      <DelayedLoading loading={false}>
        <span>spinner</span>
      </DelayedLoading>,
    );
    advance(1000);
    observer.disconnect();
    expect(rendered).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('unmounting before the delay (data arrived) shows nothing and leaves no timer', () => {
    const { container, unmount } = render(
      <DelayedLoading>
        <span>spinner</span>
      </DelayedLoading>,
    );
    advance(100);
    expect(container).toBeEmptyDOMElement();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides immediately when loading ends and waits the full delay again on the next load', () => {
    const view = (loading: boolean) => (
      <DelayedLoading loading={loading}>
        <span>spinner</span>
      </DelayedLoading>
    );
    const { rerender } = render(view(true));
    advance(300);
    expect(screen.getByText('spinner')).toBeInTheDocument();
    rerender(view(false));
    expect(screen.queryByText('spinner')).toBeNull();
    rerender(view(true));
    expect(screen.queryByText('spinner')).toBeNull();
    advance(299);
    expect(screen.queryByText('spinner')).toBeNull();
    advance(1);
    expect(screen.getByText('spinner')).toBeInTheDocument();
  });

  it('honours a custom delay', () => {
    render(
      <DelayedLoading delayMs={1000}>
        <span>spinner</span>
      </DelayedLoading>,
    );
    advance(999);
    expect(screen.queryByText('spinner')).toBeNull();
    advance(1);
    expect(screen.getByText('spinner')).toBeInTheDocument();
  });
});
