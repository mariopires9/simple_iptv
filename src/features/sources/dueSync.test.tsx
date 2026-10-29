// SRC-07 AC5 (+ PWA-04 AC2): the scheduled refresh starts the due Xtream lists through the "My
// lists" sync tracker, active list first, nothing while offline; the top-bar indicator shows it.
import 'fake-indexeddb/auto';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import { t } from '@/i18n';
import { forgetActiveSource } from './activeSource';
import { startDueSyncs, type DueSyncDeps } from './dueSync';
import { resetSourceSyncs, startSourceSync, type SyncRun, type SyncWorker } from './sourceSync';
import { SyncActivityIndicator } from './SyncActivityIndicator';
import { DAY, HOUR, makeSource, renderRoutes, seedSource, setStoredActive } from './test-utils';

const NOW = 100 * DAY;

let media: { restore(): void } | undefined;
afterEach(async () => {
  media?.restore();
  media = undefined;
  resetSourceSyncs();
  forgetActiveSource();
  await wipeAll();
});

const started = (status: 'ok' | 'error' = 'ok'): SyncRun => ({
  dispatch: 'started',
  done: Promise.resolve({ status }),
});

async function seedLists() {
  await seedSource(
    makeSource({ id: 'old', kind: 'xtream', name: 'Old', lastSyncAt: NOW - 2 * DAY }),
  );
  await seedSource(
    makeSource({ id: 'fresh', kind: 'xtream', name: 'Fresh', lastSyncAt: NOW - HOUR }),
  );
  await seedSource(
    makeSource({ id: 'active', kind: 'xtream', name: 'Active', lastSyncAt: NOW - 3 * DAY }),
  );
  await seedSource(makeSource({ id: 'm3u', kind: 'm3u-url', name: 'M3U', lastSyncAt: 0 }));
  await setStoredActive('active');
}

describe('startDueSyncs', () => {
  it('starts lists not synced for 24 h, active first, one at a time, via the tracker', async () => {
    await seedLists();
    const start = vi.fn<DueSyncDeps['start']>(() => Promise.resolve(started()));
    const result = await startDueSyncs({ start, isOnline: () => true, now: NOW });
    expect(result.started).toEqual(['active', 'old']);
    const outcomes = await result.done;
    expect(start.mock.calls.map(([s]) => s.id)).toEqual(['active', 'old']);
    expect(outcomes).toEqual([
      { sourceId: 'active', status: 'ok' },
      { sourceId: 'old', status: 'ok' },
    ]);
  });

  it('nothing while offline', async () => {
    await seedLists();
    const start = vi.fn<DueSyncDeps['start']>();
    const result = await startDueSyncs({ start, isOnline: () => false, now: NOW });
    expect(result.started).toEqual([]);
    expect(start).not.toHaveBeenCalled();
  });

  it('a list already syncing (manual Refresh) is skipped, not reported as failed', async () => {
    await seedLists();
    const start = vi.fn<DueSyncDeps['start']>((source) =>
      Promise.resolve(source.id === 'active' ? { dispatch: 'busy' } : started()),
    );
    const outcomes = await (await startDueSyncs({ start, isOnline: () => true, now: NOW })).done;
    expect(outcomes).toEqual([
      { sourceId: 'active', status: 'cancelled' },
      { sourceId: 'old', status: 'ok' },
    ]);
  });
});

describe('SyncActivityIndicator', () => {
  it('shows while a tracked sync runs and links to My lists', async () => {
    let finish!: (value: { status: 'ok' }) => void;
    const worker = (): Promise<SyncWorker> =>
      Promise.resolve({
        runTask: () =>
          new Promise((resolve) => {
            finish = resolve as typeof finish;
          }),
      } as unknown as SyncWorker);
    const view = renderRoutes([{ path: '/', element: <SyncActivityIndicator /> }], '/');
    media = view.media;
    expect(screen.queryByTestId('sync-activity')).not.toBeInTheDocument();

    let run!: SyncRun;
    await act(async () => {
      run = await startSourceSync({ id: 'tv', kind: 'xtream' }, worker);
    });
    const link = screen.getByRole('link', { name: t.lists.selector.syncing });
    expect(link).toHaveAttribute('href', '/settings/sources');

    await act(async () => {
      finish({ status: 'ok' });
      if (run.dispatch === 'started') await run.done;
    });
    expect(screen.queryByTestId('sync-activity')).not.toBeInTheDocument();
  });
});
