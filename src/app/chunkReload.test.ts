import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  installChunkReload,
  isChunkLoadError,
  page,
  reloadOnce,
} from './chunkReload';

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.sessionStorage.clear();
  reload = vi.spyOn(page, 'reload').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/a-1.js',
    'error loading dynamically imported module: https://x/assets/a-1.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('recognises a ChunkLoadError by name', () => {
    const error = new Error('x');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([new Error('boom'), 'Failed to fetch dynamically imported module', null, undefined])(
    'rejects %s',
    (value) => {
      expect(isChunkLoadError(value)).toBe(false);
    },
  );
});

describe('reloadOnce', () => {
  it('reloads, then refuses a second reload inside the window (no loop)', () => {
    expect(reloadOnce(1_000_000)).toBe(true);
    expect(reloadOnce(1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads automatically when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(reloadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a garbage stored value', () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, 'not-a-number');
    expect(reloadOnce()).toBe(true);
  });
});

describe('installChunkReload (vite:preloadError)', () => {
  it('reloads once and prevents the default (the error is not rethrown)', () => {
    const uninstall = installChunkReload();
    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // Inside the guard window: no reload, the error reaches the route error boundary.
    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);

    uninstall();
    window.sessionStorage.clear();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
