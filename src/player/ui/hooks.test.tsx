import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackError } from '../types';
import { describePlaybackError } from './describePlaybackError';
import { messages } from '@/i18n/catalogs';
import { formatPercent, formatTime } from './formatTime';
import { liveEdgePosition } from './media';
import { AUTO_HIDE_DELAY_MS, useAutoHide } from './useAutoHide';
import { useShortcuts, type ShortcutHandlers } from './useShortcuts';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
    [-3, '0:00'],
  ])('%s → %s', (seconds, expected) => {
    expect(formatTime(seconds)).toBe(expected);
  });
});

describe('describePlaybackError (minimal, TODO(PLY-04))', () => {
  it('maps every kind to a title and message', () => {
    const kinds = [
      'network',
      'blocked',
      'unsupported-container',
      'unsupported-codec',
      'decode',
      'auth',
      'unknown',
    ] as const;
    for (const kind of kinds) {
      const text = describePlaybackError(new PlaybackError({ kind }));
      expect(text.title).not.toBe('');
      expect(text.message).not.toBe('');
    }
  });

  it('uses the mixed-content text for blocked + mixed-content hint', () => {
    const cors = describePlaybackError(new PlaybackError({ kind: 'blocked', hint: 'cors' }));
    const mixed = describePlaybackError(
      new PlaybackError({ kind: 'blocked', hint: 'mixed-content' }),
    );
    expect(mixed.title).toBe('Insecure stream address');
    expect(cors.title).toBe('Stream blocked by the browser');
  });
});

function ShortcutHarness({ handlers }: { handlers: ShortcutHandlers }) {
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  useShortcuts(region, handlers);
  return (
    <div ref={setRegion} role="region" aria-label="player" tabIndex={-1}>
      <input aria-label="search" type="text" />
      <input aria-label="number" type="number" />
      <textarea aria-label="notes" />
      <div aria-label="editor" role="textbox" contentEditable suppressContentEditableWarning />
      <input aria-label="volume" type="range" />
      <button type="button">button</button>
    </div>
  );
}

describe('useShortcuts', () => {
  const all = () => ({
    togglePlay: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleMute: vi.fn(),
    seekBy: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    toggleChannelList: vi.fn(),
    close: vi.fn(),
  });
  const KEYS = [
    ' ',
    'k',
    'f',
    'm',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'l',
    'Escape',
  ];

  it('maps every key from the region', () => {
    const h = all();
    render(<ShortcutHarness handlers={h} />);
    const region = screen.getByRole('region');
    for (const key of KEYS) fireEvent.keyDown(region, { key });
    expect(h.togglePlay).toHaveBeenCalledTimes(2);
    expect(h.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(h.toggleMute).toHaveBeenCalledTimes(1);
    expect(h.seekBy.mock.calls).toEqual([[-10], [10]]);
    expect(h.previous).toHaveBeenCalledTimes(1);
    expect(h.next).toHaveBeenCalledTimes(1);
    expect(h.toggleChannelList).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('prevents the default action of handled keys only', () => {
    render(<ShortcutHarness handlers={{ togglePlay: vi.fn() }} />);
    const region = screen.getByRole('region');
    expect(fireEvent.keyDown(region, { key: ' ' })).toBe(false); // default prevented
    expect(fireEvent.keyDown(region, { key: 'f' })).toBe(true); // no handler → untouched
  });

  it.each(['search', 'number', 'notes', 'editor'])('never fires while typing in %s', (name) => {
    const h = all();
    render(<ShortcutHarness handlers={h} />);
    const field = screen.getByRole(/search|notes|editor/.test(name) ? 'textbox' : 'spinbutton', {
      name,
    });
    for (const key of KEYS) fireEvent.keyDown(field, { key });
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it('leaves arrows to sliders and Space to buttons', () => {
    const h = all();
    render(<ShortcutHarness handlers={h} />);
    const slider = screen.getByRole('slider', { name: 'volume' });
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      fireEvent.keyDown(slider, { key });
    }
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: 'm' });
    expect(h.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('ignores keys with Ctrl/Meta/Alt (browser shortcuts)', () => {
    const h = all();
    render(<ShortcutHarness handlers={h} />);
    const region = screen.getByRole('region');
    fireEvent.keyDown(region, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(region, { key: 'l', metaKey: true });
    fireEvent.keyDown(region, { key: 'k', altKey: true });
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it('uses the latest handlers without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<ShortcutHarness handlers={{ close: first }} />);
    rerender(<ShortcutHarness handlers={{ close: second }} />);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

function AutoHideHarness({ enabled, pinned }: { enabled: boolean; pinned: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const visible = useAutoHide({ enabled, pinned, container, controls });
  return (
    <div ref={setContainer} data-testid="container">
      <div ref={setControls} data-testid="controls" data-visible={visible}>
        <button type="button">control</button>
      </div>
    </div>
  );
}

describe('useAutoHide', () => {
  const visible = () => screen.getByTestId('controls').getAttribute('data-visible');

  it('never hides while pinned (menu open); hides again once unpinned', () => {
    vi.useFakeTimers();
    const { rerender } = render(<AutoHideHarness enabled pinned />);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS * 2));
    expect(visible()).toBe('true');
    rerender(<AutoHideHarness enabled pinned={false} />);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(visible()).toBe('false');
  });

  it('starts visible again after being disabled and re-enabled', () => {
    vi.useFakeTimers();
    const { rerender } = render(<AutoHideHarness enabled pinned={false} />);
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(visible()).toBe('false');
    rerender(<AutoHideHarness enabled={false} pinned={false} />);
    expect(visible()).toBe('true');
    rerender(<AutoHideHarness enabled pinned={false} />);
    expect(visible()).toBe('true');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(visible()).toBe('false');
  });

  it('pointer focus on a control (mouse click) does not keep the controls visible', () => {
    vi.useFakeTimers();
    render(<AutoHideHarness enabled pinned={false} />);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button);
    act(() => button.focus());
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(visible()).toBe('false');
  });

  it('removes its listeners on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<AutoHideHarness enabled pinned={false} />);
    const container = screen.getByTestId('container');
    const remove = vi.spyOn(container, 'removeEventListener');
    unmount();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(
      ['focusin', 'focusout', 'keydown', 'pointerdown', 'pointerleave', 'pointermove'].sort(),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('review regressions', () => {
  it('formats numbers in the given UI locale (pt-PT) and defaults to the active one', () => {
    expect(messages('pt-PT').player.locale).toBe('pt-PT');
    expect(formatPercent(0.5, 'pt-PT')).toBe(
      new Intl.NumberFormat('pt-PT', { style: 'percent' }).format(0.5),
    );
    // The locale is honoured (CLDR: pt-PT happens to print "50%", de prints "50 %").
    expect(formatPercent(0.5, 'de')).toMatch(/^50\s%$/);
    expect(formatPercent(0.5, 'en')).toBe('50%');
    expect(formatTime(3725, 'pt-PT')).toBe('1:02:05');
    // Tests run with an English navigator: the default is the active locale, `en`.
    expect(formatPercent(0.25)).toBe('25%');
  });

  it('liveEdgePosition stays max(3 × target duration, 10 s) behind the edge, inside the window', () => {
    expect(liveEdgePosition(100, 400)).toBe(390);
    expect(liveEdgePosition(100, 400, 6)).toBe(382);
    expect(liveEdgePosition(100, 400, 2)).toBe(390);
    expect(liveEdgePosition(395, 400)).toBe(395);
  });
});
