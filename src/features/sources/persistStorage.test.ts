// PWA-05 AC1: the first list saved (Xtream or M3U URL) requests persistent storage; later lists do
// not ask again. `navigator.storage` is mocked.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { saveM3uUrlSource } from './m3u/saveM3uUrlSource';
import { invalidateSourcesPresence } from './sourcesPresence';
import { saveXtreamSource } from './xtream/saveXtreamSource';

const persist = vi.fn(() => Promise.resolve(true));
const persisted = vi.fn(() => Promise.resolve(false));
let original: PropertyDescriptor | undefined;

beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(navigator, 'storage');
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist, persisted },
  });
});

afterEach(async () => {
  if (original) Object.defineProperty(navigator, 'storage', original);
  else delete (navigator as { storage?: unknown }).storage;
  persist.mockClear();
  persisted.mockClear();
  invalidateSourcesPresence();
  clearSecrets();
  await wipeAll();
});

const xtream = {
  name: 'Panel',
  host: 'panel.example.test',
  serverUrl: 'http://panel.example.test:8080',
  username: 'jdoe',
  password: 'testpass',
  lastSyncStatus: 'never' as const,
};
const m3u = { name: '', host: 'lists.example.test', url: 'https://lists.example.test/list.m3u' };

describe('persistent storage on the first list (PWA-05 AC1)', () => {
  it('Xtream: the first list asks, the second does not', async () => {
    await saveXtreamSource(xtream);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    await saveXtreamSource(xtream);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('M3U URL: the first list asks', async () => {
    await saveM3uUrlSource(m3u);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  });

  it('a refusal or a missing API never fails the save', async () => {
    persist.mockResolvedValueOnce(false);
    await expect(saveXtreamSource(xtream)).resolves.toMatchObject({ kind: 'xtream' });
    await wipeAll();
    delete (navigator as { storage?: unknown }).storage;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    await expect(saveM3uUrlSource(m3u)).resolves.toMatchObject({ kind: 'm3u-url' });
  });
});
