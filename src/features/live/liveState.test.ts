// LIV-03: persisted Live state — per-source views, tolerant reads, last channel, preference and
// the debounced saver (fake-indexeddb).
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { itemKey, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import {
  MAX_SAVED_VIEWS,
  PLAY_LAST_CHANNEL_KEY,
  SAVE_DEBOUNCE_MS,
  clearLiveState,
  createViewSaver,
  loadLiveStartup,
  saveLastChannel,
  saveLiveView,
  setPlayLastChannelOnOpen,
  type SavedLiveView,
} from './liveState';

const raw = settingsRepo as unknown as {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

const view = (categoryId: string, extra: Partial<SavedLiveView> = {}): SavedLiveView => ({
  categoryId,
  selectedIndex: 3,
  scrollTop: 128,
  savedAt: 1,
  ...extra,
});

// Saved views of lists that do not exist are pruned on read: these lists exist.
const LISTS = ['a', 'b', 'ok', ...Array.from({ length: MAX_SAVED_VIEWS + 3 }, (_, i) => `s${i}`)];
beforeAll(async () => {
  for (const [i, id] of LISTS.entries()) {
    await sourcesRepo.put({
      id,
      kind: 'm3u-url',
      name: id,
      prefs: { liveFormat: 'auto' },
      createdAt: i,
      lastSyncStatus: 'ok',
      stats: { live: 0, movies: 0, series: 0 },
    });
  }
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await clearLiveState();
});
afterAll(async () => {
  await wipeAll();
});

describe('loadLiveStartup', () => {
  it('defaults: nothing saved, "Play last channel on open" off', async () => {
    expect(await loadLiveStartup('a')).toEqual({
      view: undefined,
      playLastChannelOnOpen: false,
      lastChannelKey: undefined,
    });
  });

  it('keeps one view per source', async () => {
    await saveLiveView('a', view('20', { selectedKey: itemKey('a', 'live', '7') }));
    await saveLiveView('b', view('~favorites'));
    expect((await loadLiveStartup('a')).view).toEqual(
      view('20', { selectedKey: itemKey('a', 'live', '7') }),
    );
    expect((await loadLiveStartup('b')).view?.categoryId).toBe('~favorites');
    expect((await loadLiveStartup('c')).view).toBeUndefined();
  });

  it('ignores the last channel of another source (foreign key)', async () => {
    await saveLastChannel(itemKey('b', 'live', '9'));
    expect((await loadLiveStartup('a')).lastChannelKey).toBeUndefined();
    expect((await loadLiveStartup('b')).lastChannelKey).toBe(itemKey('b', 'live', '9'));
  });

  it('serialises the preference with the other writes (last call wins)', async () => {
    const set = vi.spyOn(settingsRepo, 'set');
    void saveLiveView('a', view('1'));
    const first = setPlayLastChannelOnOpen(true);
    const second = setPlayLastChannelOnOpen(false);
    await Promise.all([first, second]);
    const keys = set.mock.calls.map(([key]) => key);
    expect(keys).toEqual(['liveViewState', PLAY_LAST_CHANNEL_KEY, PLAY_LAST_CHANNEL_KEY]);
    expect((await loadLiveStartup('a')).playLastChannelOnOpen).toBe(false);
  });

  it('reads the preference', async () => {
    await setPlayLastChannelOnOpen(true);
    expect((await loadLiveStartup('a')).playLastChannelOnOpen).toBe(true);
    await raw.set(PLAY_LAST_CHANNEL_KEY, 'yes');
    expect((await loadLiveStartup('a')).playLastChannelOnOpen).toBe(false);
  });

  it('drops corrupt records one by one (untrusted storage)', async () => {
    await raw.set('liveViewState', {
      ok: view('10'),
      negative: view('10', { scrollTop: -5 }),
      noCategory: { selectedIndex: 0, scrollTop: 0, savedAt: 1 },
      text: 'x',
      fraction: view('10', { selectedIndex: 1.5 }),
    });
    expect((await loadLiveStartup('ok')).view).toEqual(view('10'));
    for (const id of ['negative', 'noCategory', 'text', 'fraction']) {
      expect((await loadLiveStartup(id)).view).toBeUndefined();
    }
    await raw.set('liveViewState', ['not', 'a', 'map']);
    expect((await loadLiveStartup('ok')).view).toBeUndefined();
  });

  it('prunes the saved views of removed lists when reading', async () => {
    await saveLiveView('a', view('1'));
    await saveLiveView('removed', view('2'));
    await loadLiveStartup('a');
    await saveLastChannel(itemKey('a', 'live', '1')); // queued after the pruning write
    const stored = (await raw.get('liveViewState')) as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(['a']);
  });

  it('never throws when storage fails', async () => {
    vi.spyOn(settingsRepo, 'get').mockRejectedValue(new Error('idb'));
    expect(await loadLiveStartup('a')).toEqual({
      view: undefined,
      playLastChannelOnOpen: false,
      lastChannelKey: undefined,
    });
    vi.restoreAllMocks();
  });
});

describe('saveLiveView', () => {
  it(`keeps at most ${MAX_SAVED_VIEWS} sources (the most recent)`, async () => {
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i++) {
      await saveLiveView(`s${i}`, view('1', { savedAt: i }));
    }
    const stored = (await raw.get('liveViewState')) as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(MAX_SAVED_VIEWS);
    expect(stored.s0).toBeUndefined();
    expect(stored[`s${MAX_SAVED_VIEWS + 2}`]).toBeDefined();
  });

  it('a failed write is logged, not thrown', async () => {
    vi.spyOn(settingsRepo, 'set').mockRejectedValueOnce(new Error('quota'));
    await expect(saveLiveView('a', view('1'))).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('createViewSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('writes only the latest view, after the debounce', async () => {
    const set = vi.spyOn(settingsRepo, 'set');
    const saver = createViewSaver();
    for (let top = 0; top < 50; top++) saver.schedule('a', view('1', { scrollTop: top }));
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    vi.useRealTimers();
    expect((await loadLiveStartup('a')).view?.scrollTop).toBe(49);
  });

  it('flush() writes at once; another source flushes the pending one first', async () => {
    const saver = createViewSaver();
    saver.schedule('a', view('1'));
    saver.schedule('b', view('2'));
    saver.flush();
    vi.useRealTimers();
    expect((await loadLiveStartup('a')).view?.categoryId).toBe('1');
    expect((await loadLiveStartup('b')).view?.categoryId).toBe('2');
  });
});
