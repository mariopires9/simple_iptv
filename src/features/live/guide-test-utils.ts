// Test helpers of the guide grid (EPG-04; imported by tests only): jsdom scroll metrics for the
// two-axis virtualizer.

/** Viewport of the mocked guide grid. */
export const GRID_VIEWPORT = { width: 800, height: 680 } as const;

/**
 * jsdom has no layout: give the guide grid (`role="grid"`) an 800 × 680 viewport and content
 * sizes from its sizer, and make `scrollTo` move both offsets and fire `scroll`. Returns a
 * restore function.
 */
export function installGridMetrics(): () => void {
  const targets = [Element.prototype, HTMLElement.prototype] as const;
  const names = [
    'clientWidth',
    'clientHeight',
    'scrollWidth',
    'scrollHeight',
    'scrollTop',
    'scrollLeft',
    'scrollTo',
  ];
  const originals = targets.map(
    (target) =>
      new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(target, name)] as const)),
  );
  const isGrid = (el: Element) => el.getAttribute('role') === 'grid';
  const sizer = (el: Element, axis: 'width' | 'height') => {
    const value = parseFloat((el.firstElementChild as HTMLElement | null)?.style[axis] ?? '');
    return Number.isNaN(value) ? 0 : value;
  };
  const offsets = new WeakMap<Element, { top: number; left: number }>();
  const offsetOf = (el: Element) => {
    let found = offsets.get(el);
    if (!found) {
      found = { top: 0, left: 0 };
      offsets.set(el, found);
    }
    return found;
  };
  const define = (target: object, name: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(target, name, { configurable: true, ...descriptor });
  for (const target of targets) {
    define(target, 'clientWidth', {
      get(this: Element) {
        return isGrid(this) ? GRID_VIEWPORT.width : 0;
      },
    });
    define(target, 'clientHeight', {
      get(this: Element) {
        return isGrid(this) ? GRID_VIEWPORT.height : 0;
      },
    });
  }
  define(Element.prototype, 'scrollWidth', {
    get(this: Element) {
      return isGrid(this) ? Math.max(sizer(this, 'width'), GRID_VIEWPORT.width) : 0;
    },
  });
  define(Element.prototype, 'scrollHeight', {
    get(this: Element) {
      return isGrid(this) ? Math.max(sizer(this, 'height'), GRID_VIEWPORT.height) : 0;
    },
  });
  define(Element.prototype, 'scrollTop', {
    get(this: Element) {
      return offsetOf(this).top;
    },
    set(this: Element, value: number) {
      offsetOf(this).top = value;
    },
  });
  define(Element.prototype, 'scrollLeft', {
    get(this: Element) {
      return offsetOf(this).left;
    },
    set(this: Element, value: number) {
      offsetOf(this).left = value;
    },
  });
  define(Element.prototype, 'scrollTo', {
    writable: true,
    value(this: Element, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      if (options.left !== undefined) this.scrollLeft = options.left;
      // Browsers fire `scroll` asynchronously, never inside the caller's render/effect.
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    },
  });
  return () => {
    targets.forEach((target, i) => {
      for (const [name, descriptor] of originals[i] ?? []) {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete (target as unknown as Record<string, unknown>)[name];
      }
    });
  };
}
