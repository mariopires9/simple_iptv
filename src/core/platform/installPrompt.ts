// Install prompt state (PWA-01 AC3), framework-agnostic. Chrome/Edge fire `beforeinstallprompt`
// once, early, often before the Settings screen exists, so capture starts at boot (src/main.tsx)
// and keeps the event until the user asks to install. React reads it with `useInstallPrompt`
// (src/ui/pwa).
//
// The event is captured with `preventDefault` (no Chrome mini-infobar): Settings › Install app
// offers the install instead, whenever it is opened, from the kept event. The browser's own menu
// entry stays available.
import { log } from '@/core/log';
import { detectAppleWebKit, type PlatformEnv } from './capabilities';
import { isInstalledApp } from './storage';

/** Chromium's install prompt event (not in the DOM typings: non-standard). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/**
 * - `installed`: running as an installed app (standalone display mode) or just installed.
 * - `available`: the browser offered a prompt (`beforeinstallprompt`); `prompt()` shows it.
 * - `ios`: iPhone/iPad, which never fire the event; installing is "Share → Add to Home Screen".
 * - `unsupported`: no install prompt available (other browsers, or already dismissed this session).
 */
export type InstallState = 'installed' | 'available' | 'ios' | 'unsupported';

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** The parts of `window` the store needs (injectable for tests). */
export interface InstallEnv {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener?: (type: 'change', listener: () => void) => void;
    removeEventListener?: (type: 'change', listener: () => void) => void;
  };
  navigator: PlatformEnv['navigator'] & { standalone?: boolean };
}

export interface InstallPromptStore {
  getState(): InstallState;
  subscribe(listener: () => void): () => void;
  /** Shows the browser's install dialog (once per captured event). Never rejects. */
  prompt(): Promise<InstallOutcome>;
  /** Removes the listeners (tests). */
  stop(): void;
}

export const STANDALONE_QUERY = '(display-mode: standalone)';

export function createInstallPromptStore(env: InstallEnv): InstallPromptStore {
  const listeners = new Set<() => void>();
  const isIOS = detectAppleWebKit(env.navigator).isIOS;
  const standaloneMedia = env.matchMedia?.(STANDALONE_QUERY);
  let deferred: BeforeInstallPromptEvent | undefined;
  let installed = false;

  // Same test as Settings › Storage (standalone/fullscreen display mode, iOS home-screen flag).
  const isStandalone = () => isInstalledApp(env);

  const compute = (): InstallState => {
    if (installed || isStandalone()) return 'installed';
    if (deferred) return 'available';
    if (isIOS) return 'ios';
    return 'unsupported';
  };
  let state = compute();

  const update = () => {
    const next = compute();
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const onBeforeInstallPrompt = (event: Event) => {
    // Settings offers the install from this kept event, even when opened much later.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    update();
  };
  const onAppInstalled = () => {
    installed = true;
    deferred = undefined;
    update();
  };

  env.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  env.addEventListener('appinstalled', onAppInstalled);
  standaloneMedia?.addEventListener?.('change', update);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt() {
      const event = deferred;
      if (!event) return 'unavailable';
      // The event can only be used once, whatever the user chooses.
      deferred = undefined;
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') installed = true;
        return outcome;
      } catch (error) {
        // E.g. the browser already showed its own prompt for this event (InvalidStateError).
        log.warn('pwa: install prompt failed', { error });
        return 'unavailable';
      } finally {
        update();
      }
    },
    stop() {
      env.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      env.removeEventListener('appinstalled', onAppInstalled);
      standaloneMedia?.removeEventListener?.('change', update);
      listeners.clear();
    },
  };
}

let store: InstallPromptStore | undefined;

/**
 * The app's install prompt store, created (and listening) on first call. Call it at boot so an
 * early `beforeinstallprompt` is not missed. Without `window` (non-browser) it reports
 * `unsupported`.
 */
export function installPromptStore(): InstallPromptStore {
  if (store) return store;
  store =
    typeof window === 'undefined'
      ? createInstallPromptStore({
          addEventListener: () => {},
          removeEventListener: () => {},
          navigator: { userAgent: '' },
        })
      : createInstallPromptStore(window);
  return store;
}

/** Tests only: forgets the app store so the next call starts a fresh one. */
export function resetInstallPromptStoreForTests(): void {
  store?.stop();
  store = undefined;
}
