// Recovery from lazy chunks that no longer exist (FND-04): after a redeploy, an open tab still
// references the old hashed chunk names, so the only fix is loading the new index.html.
import { log } from '@/core/log';

/** sessionStorage key: when the last automatic reload happened (loop guard). */
export const CHUNK_RELOAD_KEY = 'simple-iptv:chunk-reload-at';
/** No second automatic reload within this window: a chunk that is really missing stays an error. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /unable to preload css/i, // Vite preload helper
];

/** True for errors raised when a lazy chunk (dynamic import) cannot be loaded. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

/** Indirection so tests can observe reloads (jsdom cannot reload). */
export const page = {
  reload(): void {
    window.location.reload();
  },
};

/**
 * Reloads unless an automatic reload already happened within the window. Returns whether it
 * reloaded. Without sessionStorage it never reloads automatically (no way to prevent a loop).
 */
export function reloadOnce(now = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  page.reload();
  return true;
}

/**
 * Vite dispatches `vite:preloadError` when a dynamic import's chunk fails to load. Reload once
 * (guarded); if the guard blocks it, the error reaches the route error boundary as usual.
 * Returns the cleanup function.
 */
export function installChunkReload(target: Window = window): () => void {
  const onPreloadError = (event: Event) => {
    log.warn('Lazy chunk failed to load; reloading the page');
    if (reloadOnce()) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', onPreloadError);
  return () => target.removeEventListener('vite:preloadError', onPreloadError);
}
