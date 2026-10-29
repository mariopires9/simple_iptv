// SRC-08 AC4: the reactive active-list store (persisted to settingsRepo).
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import {
  forgetActiveSource,
  getActiveSourceSnapshot,
  loadActiveSourceId,
  setActiveSource,
  subscribeActiveSource,
  useActiveSourceChanges,
  useActiveSourceId,
} from './activeSource';

afterEach(async () => {
  forgetActiveSource();
  vi.restoreAllMocks();
  await wipeAll();
});

describe('active source store', () => {
  it('reads the stored setting once, then answers from the cache', async () => {
    await settingsRepo.set('activeSourceId', 'a');
    const get = vi.spyOn(settingsRepo, 'get');
    expect(await loadActiveSourceId()).toBe('a');
    expect(await loadActiveSourceId()).toBe('a');
    expect(get).toHaveBeenCalledTimes(1);
    expect(getActiveSourceSnapshot()).toMatchObject({ id: 'a', known: true });
  });

  it('setActiveSource persists, publishes and counts a change (not when unchanged)', async () => {
    await settingsRepo.set('activeSourceId', 'a');
    await loadActiveSourceId();
    const listener = vi.fn();
    const unsubscribe = subscribeActiveSource(listener);
    const before = getActiveSourceSnapshot().changes;

    await setActiveSource('b');
    expect(await settingsRepo.get('activeSourceId')).toBe('b');
    expect(getActiveSourceSnapshot()).toMatchObject({ id: 'b', known: true, changes: before + 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    await setActiveSource('b');
    expect(getActiveSourceSnapshot().changes).toBe(before + 1);

    await setActiveSource(undefined);
    expect(await settingsRepo.get('activeSourceId')).toBeUndefined();
    expect(getActiveSourceSnapshot()).toMatchObject({ id: undefined, changes: before + 2 });
    unsubscribe();
  });

  it('a read that started before a write does not overwrite the newer value', async () => {
    await settingsRepo.set('activeSourceId', 'old');
    const read = loadActiveSourceId();
    await setActiveSource('new');
    await read;
    expect(getActiveSourceSnapshot().id).toBe('new');
  });

  it('hooks: the id loads lazily; the change counter follows switches', async () => {
    await settingsRepo.set('activeSourceId', 'a');
    const { result } = renderHook(() => ({
      id: useActiveSourceId(),
      changes: useActiveSourceChanges(),
    }));
    await waitFor(() => expect(result.current.id).toBe('a'));
    const changes = result.current.changes;
    await act(() => setActiveSource('b'));
    expect(result.current).toEqual({ id: 'b', changes: changes + 1 });
  });
});
