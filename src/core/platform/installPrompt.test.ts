import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInstallPromptStore,
  installPromptStore,
  resetInstallPromptStoreForTests,
  STANDALONE_QUERY,
  type BeforeInstallPromptEvent,
  type InstallEnv,
} from './installPrompt';

const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iPhone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iPadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
};

class FakeWindow extends EventTarget {
  standalone = false;
  private mediaListeners = new Set<() => void>();
  constructor(readonly navigator: InstallEnv['navigator']) {
    super();
  }
  matchMedia: NonNullable<InstallEnv['matchMedia']> = (query: string) => {
    const isStandalone = () => query === STANDALONE_QUERY && this.standalone;
    return {
      get matches() {
        return isStandalone();
      },
      addEventListener: (_type: 'change', listener: () => void) =>
        this.mediaListeners.add(listener),
      removeEventListener: (_type: 'change', listener: () => void) =>
        this.mediaListeners.delete(listener),
    };
  };
  setStandalone(value: boolean) {
    this.standalone = value;
    for (const listener of this.mediaListeners) listener();
  }
}

function installEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: 'web' }) });
  return { event, prompt };
}

const chrome = () => new FakeWindow({ userAgent: UA.chrome, vendor: 'Google Inc.' });

afterEach(() => resetInstallPromptStoreForTests());

describe('install prompt store (PWA-01 AC3)', () => {
  it('Chrome: unsupported until beforeinstallprompt, then available (the infobar is kept away)', () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getState()).toBe('unsupported');

    const { event } = installEvent('accepted');
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState()).toBe('available');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an event captured before any button exists is kept (and the infobar suppressed) for Settings', async () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    const { event, prompt } = installEvent('accepted');
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // Settings opens later: it subscribes and finds the prompt available.
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getState()).toBe('available');
    await expect(store.prompt()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('fullscreen display mode also counts as installed (shared isInstalledApp)', () => {
    const win = chrome();
    win.matchMedia = (query: string) => ({
      matches: query === '(display-mode: fullscreen)',
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    expect(createInstallPromptStore(win).getState()).toBe('installed');
  });

  it('prompt(): a rejected prompt() or userChoice resolves "unavailable" and spends the event', async () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    const listener = vi.fn();
    store.subscribe(listener);
    const { event, prompt } = installEvent('accepted');
    prompt.mockRejectedValueOnce(new DOMException('already shown', 'InvalidStateError'));
    win.dispatchEvent(event);
    await expect(store.prompt()).resolves.toBe('unavailable');
    expect(store.getState()).toBe('unsupported');

    const second = installEvent('accepted');
    Object.assign(second.event, { userChoice: Promise.reject(new Error('gone')) });
    win.dispatchEvent(second.event);
    await expect(store.prompt()).resolves.toBe('unavailable');
    expect(store.getState()).toBe('unsupported');
  });

  it('prompt(): shows the browser dialog once; accepted → installed', async () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    const { event, prompt } = installEvent('accepted');
    win.dispatchEvent(event);

    await expect(store.prompt()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(store.getState()).toBe('installed');
    await expect(store.prompt()).resolves.toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('prompt(): dismissed → the event is spent, back to unsupported', async () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    win.dispatchEvent(installEvent('dismissed').event);
    await expect(store.prompt()).resolves.toBe('dismissed');
    expect(store.getState()).toBe('unsupported');
  });

  it('prompt() without an event is unavailable', async () => {
    await expect(createInstallPromptStore(chrome()).prompt()).resolves.toBe('unavailable');
  });

  it('appinstalled → installed', () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    win.dispatchEvent(installEvent('accepted').event);
    win.dispatchEvent(new Event('appinstalled'));
    expect(store.getState()).toBe('installed');
  });

  it('standalone display mode → installed, and follows display-mode changes', () => {
    const win = chrome();
    win.standalone = true;
    const store = createInstallPromptStore(win);
    expect(store.getState()).toBe('installed');
    win.setStandalone(false);
    expect(store.getState()).toBe('unsupported');
  });

  it('iPhone: manual instructions (no beforeinstallprompt on iOS)', () => {
    const win = new FakeWindow({ userAgent: UA.iPhone, vendor: 'Apple Computer, Inc.' });
    expect(createInstallPromptStore(win).getState()).toBe('ios');
  });

  it('iPadOS with a desktop user agent counts as iOS', () => {
    const win = new FakeWindow({
      userAgent: UA.iPadAsMac,
      vendor: 'Apple Computer, Inc.',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(createInstallPromptStore(win).getState()).toBe('ios');
  });

  it('iOS home-screen app (navigator.standalone) → installed', () => {
    const win = new FakeWindow({ userAgent: UA.iPhone, vendor: 'Apple Computer, Inc.' });
    win.navigator.standalone = true;
    expect(createInstallPromptStore(win).getState()).toBe('installed');
  });

  it('stop() removes the listeners', () => {
    const win = chrome();
    const store = createInstallPromptStore(win);
    store.stop();
    win.dispatchEvent(installEvent('accepted').event);
    expect(store.getState()).toBe('unsupported');
  });

  it('the app store is a singleton listening on window', () => {
    const store = installPromptStore();
    expect(installPromptStore()).toBe(store);
    window.dispatchEvent(installEvent('accepted').event);
    expect(store.getState()).toBe('available');
  });
});
