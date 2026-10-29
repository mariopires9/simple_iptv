// SRC-08 "My lists": cards (AC1), switching (AC4), remove with cascade (AC3), refresh with
// progress and cancel (AC5) and the "Add list" chooser — fake-indexeddb, real vault, mocked worker.
import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { catalogRepo, settingsRepo, sourcesRepo, vaultStore, wipeAll } from '@/core/db';
import { clearLogBuffer, clearSecrets } from '@/core/log';
import { WorkerTaskError } from '@/core/worker';
import { t } from '@/i18n';
import { forgetActiveSource } from './activeSource';
import { resetSourceSyncs } from './sourceSync';
import { SourcesScreen } from './SourcesScreen';
import { getSourcesPresent, invalidateSourcesPresence, setSourcesPresent } from './sourcesPresence';
import { forgetSources } from './sourcesList';
import { DAY, HOUR, makeSource, renderRoutes, seedSource, setStoredActive } from './test-utils';

interface PendingTask {
  name: string;
  input: { sourceId: string };
  options: {
    signal?: AbortSignal;
    onProgress?: (p: { phase: string; done: number; total?: number }) => void;
  };
  resolve: (value: { status: 'ok' | 'partial' | 'error' }) => void;
}

const tasks: PendingTask[] = [];
const runTask = vi.fn(
  (name: string, input: { sourceId: string }, options: PendingTask['options'] = {}) => {
    if (name === 'waitSyncIdle') return Promise.resolve();
    return new Promise((resolve, reject) => {
      tasks.push({ name, input, options, resolve });
      options.signal?.addEventListener('abort', () => reject(new WorkerTaskError('cancelled')));
    });
  },
);
vi.mock('@/worker', () => ({
  runTask: (...args: Parameters<typeof runTask>) => runTask(...args),
}));

const text = t.sources.myLists;
const NOW = Date.now();

const living = makeSource({
  id: 'living',
  kind: 'xtream',
  name: 'Living room',
  serverUrl: 'http://panel.example.test:8080',
  username: 'jdoe',
  secretRef: 'source:living:password',
  createdAt: 1,
  lastSyncAt: NOW - 2 * HOUR,
  stats: { live: 1234, movies: 8900, series: 410 },
});
const sports = makeSource({
  id: 'sports',
  kind: 'm3u-url',
  name: 'Sports list',
  secretRef: 'source:sports:url',
  createdAt: 2,
  lastSyncAt: NOW - DAY,
  stats: { live: 312, movies: 0, series: 0 },
});
const laptop = makeSource({
  id: 'laptop',
  kind: 'm3u-file',
  name: 'Laptop list',
  createdAt: 3,
  lastSyncStatus: 'error',
  lastSyncError: 'not-m3u',
  stats: { live: 95, movies: 0, series: 0 },
});
const beta = makeSource({
  id: 'beta',
  kind: 'xtream',
  name: 'Beta',
  secretRef: 'source:beta:password',
  createdAt: 4,
  lastSyncStatus: 'partial',
  lastSyncError: 'timeout',
  lastSyncAt: NOW - 5 * 60_000,
  lastSyncByType: {
    live: { status: 'ok', at: NOW },
    movie: { status: 'error', at: NOW, error: 'timeout' },
  },
  stats: { live: 10, movies: 0, series: 3 },
});

let media: { restore(): void } | undefined;

beforeEach(() => {
  setSourcesPresent(true);
});

afterEach(async () => {
  media?.restore();
  media = undefined;
  tasks.length = 0;
  runTask.mockClear();
  resetSourceSyncs();
  forgetActiveSource();
  forgetSources();
  invalidateSourcesPresence();
  clearSecrets();
  clearLogBuffer();
  await wipeAll();
});

async function seedAll() {
  await seedSource(living, 'living-pass');
  await seedSource(sports, 'https://lists.example.test/sports.m3u');
  await seedSource(laptop);
  await seedSource(beta, 'beta-pass');
  await setStoredActive('living');
}

function show(path = '/settings/sources') {
  const view = renderRoutes([{ path: '/settings/sources', Component: SourcesScreen }], path);
  media = view.media;
  return view;
}

const card = (id: string) => screen.getByTestId(`source-card-${id}`);
const cardHeadings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('SRC-08 AC1 — list cards', () => {
  it('shows every list, active first then by name, with all its fields', async () => {
    await seedAll();
    show();
    expect(await screen.findByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    await waitFor(() =>
      expect(cardHeadings()).toEqual(['Living room', 'Beta', 'Laptop list', 'Sports list']),
    );

    const active = within(card('living'));
    expect(active.getByText(text.active)).toBeInTheDocument();
    expect(active.getByText('Xtream · 1,234 channels · 8,900 movies · 410 series')).toBeVisible();
    expect(active.getByText('Updated 2 hours ago')).toBeVisible();
    expect(active.getByText('Up to date')).toBeVisible();
    expect(active.queryByRole('button', { name: text.actions.use })).toBeNull();
    expect(active.getByRole('button', { name: text.actions.refresh })).toBeEnabled();
    expect(active.getByRole('link', { name: text.actions.edit })).toHaveAttribute(
      'href',
      '/settings/sources/living/edit',
    );

    const m3u = within(card('sports'));
    expect(m3u.queryByText(text.active)).toBeNull();
    expect(m3u.getByText('M3U (URL) · 312 channels')).toBeVisible();
    expect(m3u.getByText('Updated yesterday')).toBeVisible();
    expect(m3u.getByRole('button', { name: text.actions.use })).toBeEnabled();

    const file = within(card('laptop'));
    expect(file.getByText('M3U (file) · 95 channels')).toBeVisible();
    expect(file.getByText('Never updated')).toBeVisible();
    expect(file.getByText('Update failed: not an M3U list')).toBeVisible();
    expect(file.getByTestId('source-status')).toHaveAttribute('data-tone', 'error');
    // A local file cannot be re-downloaded.
    expect(file.queryByRole('button', { name: text.actions.refresh })).toBeNull();

    const partial = within(card('beta'));
    expect(partial.getByText('Xtream · 10 channels · 0 movies · 3 series')).toBeVisible();
    expect(partial.getByText('Updated 5 minutes ago')).toBeVisible();
    expect(
      partial.getByText('Some content was not updated (movies): the server took too long'),
    ).toBeVisible();
    // Card actions are described by the list's name (several cards have the same buttons).
    expect(partial.getByRole('button', { name: text.actions.remove })).toHaveAccessibleDescription(
      'Beta',
    );
  });

  it('no lists → empty state with "Add list"', async () => {
    show();
    expect(await screen.findByRole('heading', { name: text.empty.title })).toBeInTheDocument();
  });
});

describe('SRC-08 AC4 — "Use this"', () => {
  it('persists the new active list, moves the badge and the focus, keeps the order rule', async () => {
    await seedAll();
    const { user } = show();
    await waitFor(() => expect(cardHeadings()[0]).toBe('Living room'));
    await user.click(within(card('sports')).getByRole('button', { name: text.actions.use }));

    await waitFor(() =>
      expect(cardHeadings()).toEqual(['Sports list', 'Beta', 'Laptop list', 'Living room']),
    );
    expect(await settingsRepo.get('activeSourceId')).toBe('sports');
    expect(within(card('sports')).getByText(text.active)).toBeInTheDocument();
    expect(within(card('living')).queryByText(text.active)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Sports list' })).toHaveFocus(),
    );
    expect(await screen.findAllByText(text.toasts.switched('Sports list'))).not.toHaveLength(0);
  });
});

describe('SRC-08 AC5 — refresh', () => {
  it('Xtream → syncXtream with progress on the card; disabled while running; done updates the card', async () => {
    await seedAll();
    const { user } = show();
    const refresh = await within(await screen.findByTestId('source-card-beta')).findByRole(
      'button',
      { name: text.actions.refresh },
    );
    await user.click(refresh);
    await waitFor(() => expect(tasks).toHaveLength(1));
    expect(tasks[0]?.name).toBe('syncXtream');
    expect(tasks[0]?.input).toEqual({ sourceId: 'beta' });
    expect(refresh).toBeDisabled();

    act(() => tasks[0]?.options.onProgress?.({ phase: 'movie', done: 1200 }));
    const panel = within(card('beta')).getByRole('group', { name: text.phases.movie });
    expect(within(panel).getByText(t.state.progress.count('1,200'))).toBeInTheDocument();
    expect(within(card('beta')).getByText(text.status.syncing)).toBeVisible();

    // The worker wrote new counts and status, then resolved.
    await sourcesRepo.update('beta', {
      lastSyncStatus: 'ok',
      lastSyncError: undefined,
      lastSyncAt: Date.now(),
      stats: { live: 20, movies: 5, series: 3 },
    });
    await act(async () => tasks[0]?.resolve({ status: 'ok' }));
    await waitFor(() =>
      expect(
        within(card('beta')).getByText('Xtream · 20 channels · 5 movies · 3 series'),
      ).toBeVisible(),
    );
    expect(within(card('beta')).getByText('Up to date')).toBeVisible();
    expect(within(card('beta')).queryByRole('group')).toBeNull();
    expect(refresh).toBeEnabled();
    expect(await screen.findAllByText(text.toasts.refreshed('Beta'))).not.toHaveLength(0);
  });

  it('M3U URL → syncM3u; Cancel stops it and waits for the worker to be idle', async () => {
    await seedAll();
    const { user } = show();
    await user.click(
      await within(await screen.findByTestId('source-card-sports')).findByRole('button', {
        name: text.actions.refresh,
      }),
    );
    await waitFor(() => expect(tasks[0]?.name).toBe('syncM3u'));
    act(() => tasks[0]?.options.onProgress?.({ phase: 'download', done: 10, total: 100 }));
    const panel = within(card('sports')).getByRole('group', { name: text.phases.download });
    await user.click(within(panel).getByRole('button', { name: t.state.cancel }));
    await waitFor(() => expect(within(card('sports')).queryByRole('group')).toBeNull());
    expect(runTask).toHaveBeenCalledWith('waitSyncIdle', { sourceId: 'sports' });
    expect(tasks[0]?.options.signal?.aborted).toBe(true);
    expect(
      within(card('sports')).getByRole('button', { name: text.actions.refresh }),
    ).toBeEnabled();
  });
});

describe('SRC-08 AC3 — remove', () => {
  it('confirmation names the list; Cancel keeps it', async () => {
    await seedAll();
    const { user } = show();
    await user.click(
      await within(await screen.findByTestId('source-card-beta')).findByRole('button', {
        name: text.actions.remove,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.remove.title('Beta') });
    expect(dialog).toHaveAccessibleDescription(text.remove.message);
    await user.click(within(dialog).getByRole('button', { name: t.state.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await sourcesRepo.get('beta')).toBeDefined();
  });

  it('removing a non-active list deletes it, its data and its vault secret; active unchanged', async () => {
    await seedAll();
    const { user } = show();
    await user.click(
      await within(await screen.findByTestId('source-card-sports')).findByRole('button', {
        name: text.actions.remove,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.remove.title('Sports list') });
    await user.click(within(dialog).getByRole('button', { name: text.remove.confirm }));

    await waitFor(() => expect(screen.queryByTestId('source-card-sports')).toBeNull());
    // Focus does not fall back to the page body.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: text.title })).toHaveFocus(),
    );
    expect(await sourcesRepo.get('sports')).toBeUndefined();
    expect(await catalogRepo.count('sports', 'live')).toBe(0);
    expect(await vaultStore.getSecret('source:sports:url')).toBeUndefined();
    expect(await credentialVault.get('source:sports:url')).toBeUndefined();
    // Other lists untouched.
    expect(await catalogRepo.count('living', 'live')).toBe(1);
    expect(await credentialVault.get('source:living:password')).toBe('living-pass');
    expect(await settingsRepo.get('activeSourceId')).toBe('living');
    expect(await screen.findAllByText(text.toasts.removed('Sports list'))).not.toHaveLength(0);
  });

  it('removing the active list makes the next one (by name) active', async () => {
    await seedAll();
    const { user } = show();
    await user.click(
      await within(await screen.findByTestId('source-card-living')).findByRole('button', {
        name: text.actions.remove,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.remove.title('Living room') });
    await user.click(within(dialog).getByRole('button', { name: text.remove.confirm }));

    await waitFor(() => expect(cardHeadings()).toEqual(['Beta', 'Laptop list', 'Sports list']));
    // Review: focus lands on the page heading (the page stays mounted after the switch).
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: text.title })).toHaveFocus(),
    );
    expect(await settingsRepo.get('activeSourceId')).toBe('beta');
    expect(within(card('beta')).getByText(text.active)).toBeInTheDocument();
    expect(await vaultStore.getSecret('source:living:password')).toBeUndefined();
    expect(getSourcesPresent()).toBe(true);
  });

  it('removing the last list → onboarding, and the guard learns there are no lists', async () => {
    await seedSource(sports, 'https://lists.example.test/sports.m3u');
    await setStoredActive('sports');
    const { user, router } = show();
    await user.click(
      await within(await screen.findByTestId('source-card-sports')).findByRole('button', {
        name: text.actions.remove,
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: text.remove.title('Sports list') });
    await user.click(within(dialog).getByRole('button', { name: text.remove.confirm }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'));
    expect(getSourcesPresent()).toBe(false);
    expect(await sourcesRepo.list()).toEqual([]);
    expect(await settingsRepo.get('activeSourceId')).toBeUndefined();
  });

  it('removing a list that is syncing cancels the sync first', async () => {
    await seedAll();
    const { user } = show();
    const betaCard = await screen.findByTestId('source-card-beta');
    await user.click(within(betaCard).getByRole('button', { name: text.actions.refresh }));
    await waitFor(() => expect(tasks).toHaveLength(1));
    await user.click(within(card('beta')).getByRole('button', { name: text.actions.remove }));
    const dialog = await screen.findByRole('dialog', { name: text.remove.title('Beta') });
    await user.click(within(dialog).getByRole('button', { name: text.remove.confirm }));
    await waitFor(() => expect(screen.queryByTestId('source-card-beta')).toBeNull());
    expect(tasks[0]?.options.signal?.aborted).toBe(true);
    expect(runTask).toHaveBeenCalledWith('waitSyncIdle', { sourceId: 'beta' });
    expect(await sourcesRepo.get('beta')).toBeUndefined();
  });
});

describe('SRC-08 — "Add list" chooser', () => {
  it('offers Xtream and M3U URL (M3U file: coming soon) and routes to the add screens', async () => {
    await seedAll();
    const { user, router } = show();
    await user.click(await screen.findByRole('button', { name: text.add }));
    const dialog = await screen.findByRole('dialog', { name: text.chooser.title });
    expect(within(dialog).getByRole('link', { name: /Xtream Codes/ })).toHaveAttribute(
      'href',
      '/settings/sources/add/xtream',
    );
    expect(within(dialog).getByRole('button', { name: /Local M3U file/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(dialog).getByRole('link', { name: /M3U list \(URL\)/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/sources/add/m3u-url'),
    );
  });
});
