// Height that makes an element fill the rest of the page's main area (LIV-01 review): the
// catalogue screens (Live, Movies) scroll inside their list or grid, never the page. Shared since
// TEC-02.
//
// The app shell is a `min-height: 100dvh` flex column (top bar · nav rail + <main> · sticky
// bottom bar in normal flow), so <main> is stretched to the free space but that height is not
// "definite" for CSS percentages, and <main> is not a flex container. Instead of hard-coding the
// bars' heights, the element is collapsed for one synchronous measurement: <main> then has its
// stretched size, and the element gets everything from its own top to <main>'s content bottom.
import { useCallback, useLayoutEffect, useState } from 'react';

function measure(el: HTMLElement, min: number): number {
  const previous = el.style.height;
  el.style.height = '0px';
  const top = el.getBoundingClientRect().top;
  const main = el.closest('main');
  let bottom: number;
  if (main) {
    const padding = Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;
    bottom = main.getBoundingClientRect().bottom - padding;
  } else {
    bottom = window.innerHeight;
  }
  el.style.height = previous;
  return Math.max(min, Math.floor(bottom - top));
}

/** Returns a ref callback and the height (px) to give the element; `undefined` until measured. */
export function useFillHeight(min: number): {
  ref: (el: HTMLElement | null) => void;
  height: number | undefined;
} {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState<number>();
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el) return undefined;
    const update = () => {
      const next = measure(el, min);
      setHeight((current) => (current === next ? current : next));
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [el, min]);

  return { ref, height };
}
