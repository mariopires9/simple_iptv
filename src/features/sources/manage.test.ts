// SRC-08 review fixes 2 and 4: removing a list blocks and waits out its syncs, a sync that still
// writes afterwards leaves no orphan rows, and the M3U form's "Delete this list" takes the same
// path (next active list, onboarding guard, vault).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, settingsRepo, sourcesRepo, vaultStore, wipeAll } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { forgetActiveSource, getActiveSourceSnapshot, loadActiveSource } from '@/core/session';
import { removeSource } from './manage';
import { deleteM3uUrlSource } from './m3u/saveM3uUrlSource';
import { resetSourceSyncs, startSourceSync, type SyncWorker } from './sourceSync';
import { getSourcesPresent, invalidateSourcesPresence } from './sourcesPresence';
import { forgetSources } from './sourcesList';
import { makeSource, seedSource } from './test-utils';

afterEach(async () => {
  resetSourceSyncs();
  forgetActiveSource();
  forgetSources();
  invalidateSourcesPresence();
  clearSecrets();
  vi.restoreAllMocks();
  await wipeAll();
});

const m3u = (id: string, name: string, createdAt: number) =>
  makeSource({ id, kind: 'm3u-url', name, secretRef: `source:${id}:url`, createdAt });

describe('removeSource', () => {
  it('no sync can start while it waits for the worker; nothing is orphaned afterwards', async () => {
    await seedSource(m3u('a', 'Alpha', 1), 'https://lists.example.test/a.m3u');
    let workerIdle!: () => void;
    const idle = new Promise<void>((resolve) => {
      workerIdle = resolve;
    });
    const runTask = vi.fn((name: string) =>
      name === 'waitSyncIdle' ? idle : new Promise(() => undefined),
    );
    const worker = () => Promise.resolve({ runTask } as unknown as SyncWorker);

    const removal = removeSource('a', worker);
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledWith('waitSyncIdle', { sourceId: 'a' }));
    // A background or user sync arriving meanwhile is refused…
    expect((await startSourceSync({ id: 'a', kind: 'm3u-url' }, worker)).dispatch).toBe('removing');
    expect(await sourcesRepo.get('a')).toBeDefined();
    workerIdle();
    await removal;

    expect(await sourcesRepo.get('a')).toBeUndefined();
    // …and a worker write that still arrives after the removal is dropped (no orphan rows).
    const late = await catalogRepo.replaceForExistingSource('a', 'live', {
      categories: [{ externalId: '1', name: 'Late' }],
      items: [{ externalId: '9', categoryExternalId: '1', name: 'Late', streamPath: '9.ts' }],
    });
    expect(late).toBeUndefined();
    expect(await catalogRepo.count('a', 'live')).toBe(0);
    expect(await catalogRepo.listCategories('a', 'live')).toEqual([]);
  });
});

describe('deleteM3uUrlSource ("Delete this list" in the M3U form)', () => {
  it('goes through removeSource: next active list, presence, vault', async () => {
    await seedSource(m3u('a', 'Zulu', 1), 'https://lists.example.test/a.m3u');
    await seedSource(m3u('b', 'Bravo', 2), 'https://lists.example.test/b.m3u');
    await seedSource(m3u('c', 'Charlie', 3), 'https://lists.example.test/c.m3u');
    await settingsRepo.set('activeSourceId', 'a');
    await loadActiveSource();

    await deleteM3uUrlSource({ id: 'a' });
    expect(await sourcesRepo.get('a')).toBeUndefined();
    expect(await vaultStore.getSecret('source:a:url')).toBeUndefined();
    expect(await credentialVault.get('source:b:url')).toBe('https://lists.example.test/b.m3u');
    // The next list by name becomes active, and the session is told.
    expect(await settingsRepo.get('activeSourceId')).toBe('b');
    expect(getActiveSourceSnapshot().id).toBe('b');
    expect(getSourcesPresent()).toBe(true);

    await deleteM3uUrlSource({ id: 'b' });
    await deleteM3uUrlSource({ id: 'c' });
    expect(getSourcesPresent()).toBe(false);
    expect(getActiveSourceSnapshot()).toEqual({ id: undefined, known: true });
  });
});
