// PWA-05 — persistent storage and quota, with mocked StorageManager APIs.
import { describe, expect, it, vi } from 'vitest';
import { getStorageStatus, isInstalledApp, requestPersistentStorage } from './storage';

describe('requestPersistentStorage (PWA-05 AC1)', () => {
  it('asks the browser and returns its answer', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const persisted = vi.fn(() => Promise.resolve(false));
    expect(await requestPersistentStorage({ persist, persisted })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when already persisted (Firefox would prompt)', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    expect(
      await requestPersistentStorage({ persist, persisted: () => Promise.resolve(true) }),
    ).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('a refusal is false; a missing API or a failure is undefined (never throws)', async () => {
    expect(await requestPersistentStorage({ persist: () => Promise.resolve(false) })).toBe(false);
    expect(await requestPersistentStorage({})).toBeUndefined();
    expect(await requestPersistentStorage(undefined)).toBeUndefined();
    expect(
      await requestPersistentStorage({ persist: () => Promise.reject(new Error('denied')) }),
    ).toBeUndefined();
  });

  it('uses navigator.storage by default', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist } });
    try {
      expect(await requestPersistentStorage()).toBe(true);
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(navigator, 'storage', original);
      else delete (navigator as { storage?: unknown }).storage;
    }
  });
});

describe('getStorageStatus (PWA-05 AC1)', () => {
  it('reports persisted() and estimate()', async () => {
    expect(
      await getStorageStatus({
        persisted: () => Promise.resolve(true),
        estimate: () => Promise.resolve({ usage: 1234, quota: 5678 }),
      }),
    ).toEqual({ persisted: true, canPersist: false, usage: 1234, quota: 5678 });
  });

  it('tolerates missing or failing APIs', async () => {
    expect(await getStorageStatus(undefined)).toEqual({ persisted: undefined, canPersist: false });
    expect(
      await getStorageStatus({
        persisted: () => Promise.reject(new Error('x')),
        estimate: () => Promise.resolve({}),
      }),
    ).toEqual({ persisted: undefined, canPersist: false });
    // Older Safari: persist() without persisted() — the app can still ask.
    expect(await getStorageStatus({ persist: () => Promise.resolve(true) })).toEqual({
      persisted: undefined,
      canPersist: true,
    });
  });
});

describe('isInstalledApp (PWA-05 AC2)', () => {
  const media = (matching: string[]) => (query: string) => ({ matches: matching.includes(query) });

  it('standalone or fullscreen display mode, or the iOS home-screen flag', () => {
    expect(isInstalledApp({ matchMedia: media(['(display-mode: standalone)']) })).toBe(true);
    expect(isInstalledApp({ matchMedia: media(['(display-mode: fullscreen)']) })).toBe(true);
    expect(isInstalledApp({ matchMedia: media([]), navigator: { standalone: true } })).toBe(true);
  });

  it('a browser tab is not installed', () => {
    expect(isInstalledApp({ matchMedia: media([]), navigator: {} })).toBe(false);
    expect(isInstalledApp({})).toBe(false);
    expect(
      isInstalledApp({
        matchMedia: () => {
          throw new Error('no matchMedia');
        },
      }),
    ).toBe(false);
  });
});
