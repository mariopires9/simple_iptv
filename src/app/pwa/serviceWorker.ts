/// <reference types="vite-plugin-pwa/vanillajs" />
// Service worker registration and update state (PWA-02; the update prompt UI is PWA-03).
//
// - Production only: src/main.tsx calls `registerServiceWorker()` behind `import.meta.env.PROD`.
// - The registration code (vite-plugin-pwa's `virtual:pwa-register`, i.e. workbox-window) is a
//   lazy chunk, so it stays out of the initial bundle. It registers `<base>sw.js` with the base
//   path as scope (build/pwa.ts), after the window `load` event.
// - `registerType: 'prompt'`: a new version only takes over after `applyServiceWorkerUpdate()`
//   (PWA-03 shows the prompt and must never call it during playback).
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { log } from '@/core/log';

export interface ServiceWorkerStatus {
  /** A new version is installed and waiting; `applyServiceWorkerUpdate()` activates it. */
  readonly needRefresh: boolean;
  /** The app shell is precached: the app can start without network. */
  readonly offlineReady: boolean;
}

/** `registerSW` from `virtual:pwa-register` (injectable for tests). */
export type RegisterServiceWorker = (
  options: RegisterSWOptions,
) => (reloadPage?: boolean) => Promise<void>;

const loadRegister = (): Promise<RegisterServiceWorker> =>
  import('virtual:pwa-register').then((module) => module.registerSW);

const INITIAL: ServiceWorkerStatus = { needRefresh: false, offlineReady: false };

let status: ServiceWorkerStatus = INITIAL;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registration: Promise<void> | undefined;
const listeners = new Set<() => void>();

function setStatus(patch: Partial<ServiceWorkerStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
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
        onOfflineReady: () => setStatus({ offlineReady: true }),
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
 * PWA-03 hook: activates the waiting version (`SKIP_WAITING`) and reloads the page. Only call it
 * after the user chose to update, and never during playback. No-op without a waiting version.
 */
export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!status.needRefresh || !updateServiceWorker) return;
  await updateServiceWorker(true);
}

/** Tests only: back to the state before registration. */
export function resetServiceWorkerForTests(): void {
  status = INITIAL;
  updateServiceWorker = undefined;
  registration = undefined;
  listeners.clear();
}
