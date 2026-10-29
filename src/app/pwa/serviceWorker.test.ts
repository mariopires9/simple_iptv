import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import {
  applyServiceWorkerUpdate,
  getServiceWorkerStatus,
  registerServiceWorker,
  resetServiceWorkerForTests,
  subscribeServiceWorkerStatus,
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

beforeEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  clearLogBuffer();
});

afterEach(() => {
  resetServiceWorkerForTests();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('service worker registration (PWA-02)', () => {
  it('registers once and tracks offline-ready / waiting-update state', async () => {
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

  it('never activates a new version on its own (registerType prompt, PWA-03 decides)', async () => {
    const sw = fakeRegister();
    await registerServiceWorker(() => Promise.resolve(sw.register));
    sw.options().onNeedRefresh?.();
    expect(sw.update).not.toHaveBeenCalled();

    await applyServiceWorkerUpdate();
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('applyServiceWorkerUpdate is a no-op without a waiting version', async () => {
    const sw = fakeRegister();
    await registerServiceWorker(() => Promise.resolve(sw.register));
    await applyServiceWorkerUpdate();
    expect(sw.update).not.toHaveBeenCalled();
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
    const sw = fakeRegister();
    await registerServiceWorker(() => Promise.resolve(sw.register));
    sw.options().onRegisterError?.(new Error('blocked'));
    expect(getLogEntries().some((e) => e.message.includes('registration failed'))).toBe(true);
  });

  it('loads the registration code lazily (initial bundle budget)', () => {
    const source = readFileSync(join(import.meta.dirname, 'serviceWorker.ts'), 'utf8');
    expect(source).toMatch(/import\('virtual:pwa-register'\)/);
    expect(source).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+['"]virtual:pwa-register['"]/m);
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8');
    expect(main).toMatch(/if \(import\.meta\.env\.PROD\) void registerServiceWorker\(\)/);
  });
});
