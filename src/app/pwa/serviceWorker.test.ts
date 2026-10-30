import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { claimPlayback, resetPlaybackForTests } from '@/core/session';
import {
  applyServiceWorkerUpdate,
  getServiceWorkerStatus,
  registerServiceWorker,
  resetServiceWorkerForTests,
  startUpdateChecks,
  subscribeServiceWorkerStatus,
  swPage,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  type RegisterServiceWorker,
} from './serviceWorker';

function fakeRegister() {
  let options: RegisterSWOptions = {};
  const update = vi.fn((_reload?: boolean) => Promise.resolve());
  const register: RegisterServiceWorker = vi.fn((o: RegisterSWOptions) => {
    options = o;
    return update;
  });
  return { register, update, options: () => options };
}

async function registered() {
  const sw = fakeRegister();
  await registerServiceWorker(() => Promise.resolve(sw.register));
  return sw;
}

let reload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  reload = vi.spyOn(swPage, 'reload').mockImplementation(() => {});
  clearLogBuffer();
});

afterEach(() => {
  resetServiceWorkerForTests();
  resetPlaybackForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('service worker registration (PWA-02)', () => {
  it('registers once and tracks offline-ready / new-version state', async () => {
    const sw = fakeRegister();
    const listener = vi.fn();
    subscribeServiceWorkerStatus(listener);
    await Promise.all([
      registerServiceWorker(() => Promise.resolve(sw.register)),
      registerServiceWorker(() => Promise.resolve(sw.register)),
    ]);
    expect(sw.register).toHaveBeenCalledTimes(1);
    expect(getServiceWorkerStatus()).toEqual({ needRefresh: false, offlineReady: false });

    sw.options().onOfflineReady?.();
    expect(getServiceWorkerStatus().offlineReady).toBe(true);
    sw.options().onNeedRefresh?.();
    expect(getServiceWorkerStatus().needRefresh).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does nothing where service workers are not supported', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const load = vi.fn();
    await registerServiceWorker(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('logs (never throws) when the registration chunk or the registration fails', async () => {
    await registerServiceWorker(() => Promise.reject(new Error('chunk failed')));
    expect(getLogEntries().some((e) => e.message.includes('could not start'))).toBe(true);

    resetServiceWorkerForTests();
    const sw = await registered();
    sw.options().onRegisterError?.(new Error('blocked'));
    expect(getLogEntries().some((e) => e.message.includes('registration failed'))).toBe(true);
  });

  it('loads the registration code lazily (initial bundle budget)', () => {
    const source = readFileSync(join(import.meta.dirname, 'serviceWorker.ts'), 'utf8');
    expect(source).toMatch(/import\('virtual:pwa-register'\)/);
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+['"]virtual:pwa-register['"]/m);
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8');
    // Production only, once the first screen is up (QA-04: `App` calls `onStarted` when idle).
    expect(main).toMatch(/import\.meta\.env\.PROD \? \(\) => void registerServiceWorker\(\)/);
    expect(main).toMatch(/<App onStarted=\{onStarted\} \/>/);
  });
});

describe('predictable updates (PWA-03)', () => {
  it('AC2: a new version is never activated on its own', async () => {
    const sw = await registered();
    sw.options().onNeedRefresh?.();
    expect(sw.update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('AC3: "Update" sends SKIP_WAITING, then reloads this page in place on the takeover', async () => {
    const sw = await registered();
    sw.options().onNeedRefresh?.();
    await applyServiceWorkerUpdate();
    expect(sw.update).toHaveBeenCalledWith(true);
    // Even with a player open, the takeover the user asked for reloads (same URL: route kept).
    claimPlayback();
    sw.options().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('applyServiceWorkerUpdate is a no-op without a new version', async () => {
    const sw = await registered();
    await applyServiceWorkerUpdate();
    expect(sw.update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('another tab updated: an idle tab reloads to the new version', async () => {
    const sw = await registered();
    sw.options().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('another tab updated: a tab that is playing keeps playing and offers "Update"', async () => {
    const sw = await registered();
    const release = claimPlayback();
    sw.options().onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();
    expect(getServiceWorkerStatus().needRefresh).toBe(true);

    release();
    await applyServiceWorkerUpdate();
    // The new version already controls the page: Update only reloads (no SKIP_WAITING needed).
    expect(sw.update).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('looks for a new version when the app becomes visible (throttled) and every hour', async () => {
    vi.useFakeTimers();
    const reg = { installing: null, update: vi.fn(() => Promise.resolve()) };
    const stop = startUpdateChecks(reg);
    const visible = () => document.dispatchEvent(new Event('visibilitychange'));

    visible();
    expect(reg.update).not.toHaveBeenCalled(); // just registered: too soon
    vi.advanceTimersByTime(UPDATE_CHECK_MIN_GAP_MS);
    visible();
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('skips the check offline or while a version is installing; a failed check is logged', async () => {
    vi.useFakeTimers();
    const reg = {
      installing: {} as unknown,
      update: vi.fn(() => Promise.reject(new Error('network'))),
    };
    const stop = startUpdateChecks(reg);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).not.toHaveBeenCalled();

    reg.installing = null;
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(getLogEntries().some((e) => e.message.includes('update check failed'))).toBe(true),
    );
    stop();
  });

  it('starts the checks once the service worker is registered', async () => {
    vi.useFakeTimers();
    const sw = await registered();
    const reg = { installing: null, update: vi.fn(() => Promise.resolve()) };
    sw.options().onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
