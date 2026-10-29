/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker registration and predictable updates (PWA-02, PWA-03).
//
// - Production only: src/main.tsx calls `registerServiceWorker()` behind `import.meta.env.PROD`.
// - The registration code (vite-plugin-pwa's `virtual:pwa-register`, i.e. workbox-window) is a
//   lazy chunk, so it stays out of the initial bundle. It registers `<base>sw.js` with the base
//   path as scope (build/pwa.ts), after the window `load` event.
// - `registerType: 'prompt'`: a new version waits until the user presses "Update"
//   (`applyServiceWorkerUpdate`, offered by UpdatePrompt.tsx). Then the waiting worker gets
//   `SKIP_WAITING`, takes control, and the page reloads on the same URL (hash route kept).
// - Other tabs: when a new version takes control because another tab updated, a tab reloads only
//   if no player is open in it; a tab that is playing keeps going and offers "Update" instead.
// - New versions are looked for when the app becomes visible again and every hour.
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { log } from '@/core/log';
import { isPlaybackActive } from '@/core/session';

export interface ServiceWorkerStatus {
  /** A new version is available; `applyServiceWorkerUpdate()` switches to it. */
  readonly needRefresh: boolean;
  /** The app shell is precached: the app can start without network. */
  readonly offlineReady: boolean;
}

/** `registerSW` from `virtual:pwa-register` (injectable for tests). */
export type RegisterServiceWorker = (
  options: RegisterSWOptions,
) => (reloadPage?: boolean) => Promise<void>;

/** The parts of a `ServiceWorkerRegistration` the update checks use. */
export interface UpdatableRegistration {
  readonly installing: unknown;
  update(): Promise<unknown>;
}

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Visibility changes closer than this to the last check do not check again. */
export const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;

const loadRegister = (): Promise<RegisterServiceWorker> =>
  import('virtual:pwa-register').then((module) => module.registerSW);

/** Indirection so tests can observe reloads (jsdom cannot reload). Keeps the URL and its hash. */
export const swPage = {
  reload(): void {
    window.location.reload();
  },
};

const INITIAL: ServiceWorkerStatus = { needRefresh: false, offlineReady: false };

let status: ServiceWorkerStatus = INITIAL;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registration: Promise<void> | undefined;
/** The user pressed "Update" in this tab: the coming takeover must reload it. */
let updateRequested = false;
/** A new version already controls this tab (another tab updated): "Update" only reloads. */
let takenOver = false;
let stopUpdateChecks: (() => void) | undefined;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<ServiceWorkerStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

/** A new service worker took control of this page (after `SKIP_WAITING`, from any tab). */
function onTakeover(): void {
  if (updateRequested || !isPlaybackActive()) {
    swPage.reload();
    return;
  }
  // Playing: never reload under the player (PWA-03 AC2); offer the update instead.
  takenOver = true;
  setStatus({ needRefresh: true });
}

/** Looks for a new version on visibility (throttled) and every hour; returns the stop function. */
export function startUpdateChecks(reg: UpdatableRegistration): () => void {
  let last = Date.now();
  const check = (force: boolean) => {
    const now = Date.now();
    if (!force && now - last < UPDATE_CHECK_MIN_GAP_MS) return;
    if (reg.installing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    last = now;
    reg.update().catch((error: unknown) => log.warn('pwa: update check failed', { error }));
  };
  const timer = setInterval(() => check(true), UPDATE_CHECK_INTERVAL_MS);
  const onVisibility = () => {
    if (document.visibilityState === 'visible') check(false);
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Registers the service worker once. Resolves when registration has been requested (failures are
 * logged, never thrown: the app works without a service worker).
 */
export function registerServiceWorker(
  load: () => Promise<RegisterServiceWorker> = loadRegister,
): Promise<void> {
  registration ??= (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
      const registerSW = await load();
      updateServiceWorker = registerSW({
        onNeedRefresh: () => setStatus({ needRefresh: true }),
        onNeedReload: onTakeover,
        onOfflineReady: () => setStatus({ offlineReady: true }),
        onRegisteredSW: (_url: string, reg: ServiceWorkerRegistration | undefined) => {
          if (reg) stopUpdateChecks = startUpdateChecks(reg);
        },
        onRegisterError: (error: unknown) =>
          log.warn('pwa: service worker registration failed', { error }),
      });
    } catch (error) {
      log.warn('pwa: service worker registration could not start', { error });
    }
  })();
  return registration;
}

export function getServiceWorkerStatus(): ServiceWorkerStatus {
  return status;
}

/** Called whenever the status changes; returns the unsubscribe function. */
export function subscribeServiceWorkerStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The user chose "Update" (PWA-03 AC3): activates the waiting version (`SKIP_WAITING`) and reloads
 * this page on the same URL. No-op without a new version.
 */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!status.needRefresh) return;
  if (takenOver || !updateServiceWorker) {
    swPage.reload();
    return;
  }
  updateRequested = true;
  // The reload follows the takeover (`onNeedReload` → `onTakeover`).
  await updateServiceWorker(true);
}

/** Tests only: back to the state before registration. */
export function resetServiceWorkerForTests(): void {
  stopUpdateChecks?.();
  stopUpdateChecks = undefined;
  status = INITIAL;
  updateServiceWorker = undefined;
  registration = undefined;
  updateRequested = false;
  takenOver = false;
  listeners.clear();
}
