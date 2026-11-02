// PLY-09: immersive player on a touch phone turned to landscape (CSS "pseudo-fullscreen").
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { installFullscreenApi } from './test-utils/fakeDisplay';
import { DESKTOP, LIVE, MOBILE, VOD, flush, renderPlayer } from './test-utils/renderPlayer';
import { AUTO_HIDE_DELAY_MS } from './useAutoHide';
import { IMMERSIVE_HIDDEN_ATTR, IMMERSIVE_QUERY } from './useImmersive';
import { resetImmersiveOnRotateSettingForTests } from './useImmersiveOnRotateSetting';

/** `matchMedia` where only IMMERSIVE_QUERY can match; `rotate` flips it and fires `change`. */
function installImmersiveQuery(landscape: boolean) {
  let matches = landscape;
  const listeners = new Set<() => void>();
  const immersive = {
    get matches() {
      return matches;
    },
    media: IMMERSIVE_QUERY,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) =>
      media === IMMERSIVE_QUERY
        ? immersive
        : { matches: false, media, addEventListener() {}, removeEventListener() {} },
    ),
  });
  return {
    rotate(value: boolean) {
      matches = value;
      act(() => [...listeners].forEach((cb) => cb()));
    },
    restore() {
      if (previous) Object.defineProperty(window, 'matchMedia', previous);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}

/** Stand-ins for the app shell around the player: a top bar and a navigation, focusable. */
function installShell() {
  const header = document.createElement('header');
  header.append(Object.assign(document.createElement('button'), { textContent: 'Menu' }));
  const nav = document.createElement('nav');
  nav.setAttribute('aria-hidden', 'false');
  nav.append(Object.assign(document.createElement('a'), { href: '#live', textContent: 'Live' }));
  const preInert = document.createElement('aside');
  preInert.setAttribute('inert', '');
  document.body.prepend(header, nav, preInert);
  return {
    header,
    nav,
    preInert,
    remove: () => [header, nav, preInert].forEach((e) => e.remove()),
  };
}

const restores: Array<() => void> = [];
beforeEach(() => resetImmersiveOnRotateSettingForTests());
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  while (restores.length > 0) restores.pop()?.();
  resetImmersiveOnRotateSettingForTests();
  await wipeAll();
});

function setup(landscape: boolean, props: Parameters<typeof renderPlayer>[0] = {}) {
  const query = installImmersiveQuery(landscape);
  restores.push(query.restore);
  const shell = installShell();
  restores.push(shell.remove);
  const view = renderPlayer({ platform: MOBILE, descriptor: LIVE, ...props });
  return { ...view, query, shell };
}

/** The emotion rules applied to an element (jsdom drops `env()`/`dvh` from computed styles). */
function emotionCss(element: Element): string {
  const css = Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  return Array.from(element.classList)
    .filter((cls) => cls.startsWith('css-'))
    .flatMap((cls) => css.match(new RegExp(`\\.${cls}\\{[^}]*\\}`, 'g')) ?? [])
    .join('\n');
}

const isImmersive = (region: HTMLElement) =>
  region.hasAttribute('data-immersive') && getComputedStyle(region).position === 'fixed';

describe('PlayerView — immersive landscape (PLY-09)', () => {
  it('AC1/AC5: a phone in landscape covers the viewport and hides the rest of the app', async () => {
    const t = setup(true);
    await flush();
    const region = t.region();
    expect(isImmersive(region)).toBe(true);
    const style = getComputedStyle(region);
    expect(style.inset === '0' || style.inset === '0px' || style.top === '0px').toBe(true);
    const css = emotionCss(region);
    expect(css).toContain('width:100dvw');
    expect(css).toContain('height:100dvh');
    expect(css).toMatch(/background-color:(#000|black|rgb\(0, ?0, ?0\))/);
    expect(region.querySelector('video')).toHaveStyle({ objectFit: 'contain' });
    // The rest of the app: not focusable, out of the accessibility tree, hidden.
    for (const el of [t.shell.header, t.shell.nav]) {
      expect(el).toHaveAttribute('inert');
      expect(el).toHaveAttribute(IMMERSIVE_HIDDEN_ATTR);
    }
    expect(t.shell.header).toHaveAttribute('aria-hidden', 'true');
    // The player keeps its role and name, and is not hidden itself.
    expect(screen.getByRole('region', { name: 'Player: Channel' })).toBe(region);
    expect(region.closest('[inert]')).toBeNull();
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('AC1: works for movies and episodes too (VOD)', async () => {
    const t = setup(true, { descriptor: VOD });
    await flush();
    expect(isImmersive(t.region())).toBe(true);
  });

  it('AC1: the controls auto-hide as in fullscreen and clear the safe areas', async () => {
    // Only the timers: fake-indexeddb (settings reads) keeps its own scheduling.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup(true, { immersiveOnRotate: true });
    await flush();
    const controls = screen.getByTestId('player-controls');
    const css = emotionCss(controls);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`padding-${side}:env(safe-area-inset-${side})`);
    }
    expect(controls).toHaveAttribute('data-visible', 'true');
    act(() => vi.advanceTimersByTime(AUTO_HIDE_DELAY_MS));
    expect(controls).toHaveAttribute('data-visible', 'false');
    fireEvent.pointerDown(t.region());
    expect(controls).toHaveAttribute('data-visible', 'true');
  });

  it('AC1/AC2: rotating starts no playback or reload; portrait restores layout and focus', async () => {
    const t = setup(false);
    await flush();
    const region = t.region();
    const video = region.querySelector('video');
    expect(isImmersive(region)).toBe(false);
    const plays = t.controller.play.mock.calls.length;
    const stops = t.controller.stop.mock.calls.length;
    expect(document.activeElement).toBe(region);

    t.query.rotate(true);
    await flush();
    expect(isImmersive(t.region())).toBe(true);
    expect(t.shell.header).toHaveAttribute('inert');

    t.query.rotate(false);
    await flush();
    // Same elements (nothing re-mounted), same engine, focus kept.
    expect(t.region()).toBe(region);
    expect(region.querySelector('video')).toBe(video);
    expect(isImmersive(region)).toBe(false);
    expect(t.controller.play).toHaveBeenCalledTimes(plays);
    expect(t.controller.stop).toHaveBeenCalledTimes(stops);
    expect(document.activeElement).toBe(region);
    // Only what the player added is removed.
    expect(t.shell.header).not.toHaveAttribute('inert');
    expect(t.shell.header).not.toHaveAttribute('aria-hidden');
    expect(t.shell.header).not.toHaveAttribute(IMMERSIVE_HIDDEN_ATTR);
    expect(t.shell.nav).toHaveAttribute('aria-hidden', 'false');
    expect(t.shell.preInert).toHaveAttribute('inert');
  });

  it('AC2: the fullscreen button still requests real fullscreen while immersive', async () => {
    const fs = installFullscreenApi();
    restores.push(fs.restore);
    setup(true);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await flush();
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
  });

  it('AC1: leaving the player gives the rest of the app back', async () => {
    const t = setup(true);
    await flush();
    expect(t.shell.header).toHaveAttribute('inert');
    t.unmount();
    expect(t.shell.header).not.toHaveAttribute('inert');
    expect(t.shell.header).not.toHaveAttribute('aria-hidden');
  });

  it('AC3: the stored setting off keeps the normal layout in landscape', async () => {
    await settingsRepo.set('immersiveOnRotate', false);
    const t = setup(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await flush();
    expect(isImmersive(t.region())).toBe(false);
    expect(t.shell.header).not.toHaveAttribute('inert');
  });

  it('AC3: the prop overrides the setting', async () => {
    const t = setup(true, { immersiveOnRotate: false });
    await flush();
    expect(isImmersive(t.region())).toBe(false);
  });

  it('AC4: desktop is unchanged', async () => {
    const t = setup(true, { platform: DESKTOP });
    await flush();
    expect(isImmersive(t.region())).toBe(false);
    expect(t.shell.header).not.toHaveAttribute('inert');
  });

  it('AC4: a phone in portrait (or a tablet: the query does not match) is unchanged', async () => {
    const t = setup(false);
    await flush();
    expect(isImmersive(t.region())).toBe(false);
    expect(getComputedStyle(t.region()).position).toBe('relative');
  });
});
