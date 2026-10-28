// Test helpers of features/live (imported by tests only): a synthetic catalogue in
// fake-indexeddb, jsdom scroll metrics for the virtualizer and a router around the Live screen.
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  catalogRepo,
  settingsRepo,
  sourcesRepo,
  type CatalogItemInput,
  type Source,
} from '@/core/db';
import { CHANNEL_ROW_HEIGHT } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { LiveScreen } from './LiveScreen';

export const SOURCE_ID = 'src1';
/** Created first, without a catalogue: the fallback when `activeSourceId` is not set. */
export const EMPTY_SOURCE_ID = 'src0';
export const TOTAL_CHANNELS = 20_000;
/** Visible rows of the mocked listbox viewport. */
export const VIEWPORT_ROWS = 10;

/** Source categories in their original order: [externalId, name, channel count]. */
export const SEEDED_CATEGORIES = [
  ['10', 'News', 5],
  ['20', 'Sports', 5],
  ['30', 'Mega', TOTAL_CHANNELS - 10],
  ['40', 'Empty', 0],
] as const;

function source(id: string, name: string, createdAt: number): Source {
  return {
    id,
    kind: 'm3u-url',
    name,
    prefs: { liveFormat: 'auto' },
    createdAt,
    lastSyncStatus: 'ok',
    stats: { live: 0, movies: 0, series: 0 },
  };
}

/**
 * Channel `n` (1-based) is the n-th row of "All": items are written grouped by category in
 * category order, so "All" (categories concatenated) lists them in that same order.
 */
export async function seedCatalog(): Promise<void> {
  await sourcesRepo.put(source(EMPTY_SOURCE_ID, 'Empty list', 1));
  await sourcesRepo.put(source(SOURCE_ID, 'Test list', 2));
  const items: CatalogItemInput<'live'>[] = [];
  for (const [externalId, , count] of SEEDED_CATEGORIES) {
    for (let i = 0; i < count; i++) {
      const n = items.length + 1;
      items.push({
        externalId: String(n),
        categoryExternalId: externalId,
        name: `Channel ${n}`,
        number: n,
        streamPath: `${n}.ts`,
        ...(n === 1 ? { logo: 'https://logos.example/1.png' } : {}),
      });
    }
  }
  await catalogRepo.replaceForSource(SOURCE_ID, 'live', {
    categories: SEEDED_CATEGORIES.map(([externalId, name]) => ({ externalId, name })),
    items,
  });
  await settingsRepo.set('activeSourceId', SOURCE_ID);
}

/**
 * jsdom has no layout: give the listbox a 10-row viewport, and make `scrollTo` move `scrollTop`
 * and fire `scroll` as a browser would. Returns a restore function.
 */
export function installScrollMetrics(): () => void {
  const proto = HTMLElement.prototype;
  const originals = {
    clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
    scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
  };
  const tops = new WeakMap<Element, number>();
  const isList = (el: Element) => el.getAttribute('role') === 'listbox';
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isList(this) ? VIEWPORT_ROWS * CHANNEL_ROW_HEIGHT : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return isList(this) ? 400 : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, value);
    },
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: Element, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      // Browsers fire `scroll` asynchronously, never inside the caller's render/effect.
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    },
  });
  return () => {
    for (const [name, descriptor] of Object.entries(originals)) {
      const target = name.startsWith('client') ? proto : Element.prototype;
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete (target as unknown as Record<string, unknown>)[name];
    }
  };
}

const routes = [
  { path: '/live', Component: LiveScreen },
  { path: '/live/category/:categoryId', Component: LiveScreen },
  { path: '*', element: null },
];

/** Renders the Live screen at `path` with a viewport `width` (default: desktop). */
export function renderLive(path = '/live', width = 1400) {
  const media = installMatchMedia({ width });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeModeProvider>
      <RouterProvider router={router} />
    </ThemeModeProvider>,
  );
  return { ...view, router, media };
}
