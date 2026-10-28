import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFillHeight } from './useFillHeight';

function Filler() {
  const { ref, height } = useFillHeight(320);
  return (
    <div ref={ref} data-testid="filler" style={height !== undefined ? { height } : undefined} />
  );
}

const rect = (top: number, bottom: number) =>
  ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top }) as DOMRect;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFillHeight', () => {
  it("fills from the element's top to <main>'s content bottom, without hard-coded bars", () => {
    let mainBottom = 800;
    const seenHeights: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.tagName === 'MAIN') return rect(56, mainBottom);
      // The element is collapsed while <main> is measured.
      seenHeights.push(this.style.height);
      return rect(72, 72);
    });
    render(
      <main style={{ paddingBottom: '16px' }}>
        <Filler />
      </main>,
    );
    // 800 − 16 (padding) − 72 (top).
    expect(screen.getByTestId('filler').style.height).toBe('712px');
    expect(seenHeights.every((h) => h === '0px')).toBe(true);

    // The bottom bar grows / the viewport shrinks: re-measured on resize, with a minimum.
    mainBottom = 300;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('filler').style.height).toBe('320px');
  });
});
