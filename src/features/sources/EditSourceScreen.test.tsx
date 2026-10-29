// SRC-08 AC2: edit a list — rename any kind; Xtream server/username/password are re-tested against
// the synthetic MSW panel before being applied, and the new password goes to the vault.
import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { sourcesRepo, wipeAll } from '@/core/db';
import { clearLogBuffer, clearSecrets } from '@/core/log';
import { t } from '@/i18n';
import { testConnection } from '@/providers/xtream';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { forgetActiveSource } from './activeSource';
import { updateXtreamSource } from './manage';
import { EditSourceScreen } from './EditSourceScreen';
import { forgetSources } from './sourcesList';
import { makeSource, renderRoutes, seedSource } from './test-utils';
import type { XtreamSourceFormDeps } from './xtream/XtreamSourceForm';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let media: { restore(): void } | undefined;
afterEach(async () => {
  media?.restore();
  media = undefined;
  server.resetHandlers();
  vi.restoreAllMocks();
  forgetActiveSource();
  forgetSources();
  clearSecrets();
  clearLogBuffer();
  await wipeAll();
});

const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const REF = 'source:tv:password';
const text = t.sources;

const xtream = (overrides: { username?: string } = {}) =>
  makeSource({
    id: 'tv',
    kind: 'xtream',
    name: 'Living room',
    serverUrl: XTREAM_TEST_BASE_URL,
    username: overrides.username ?? USER,
    secretRef: REF,
    stats: { live: 5, movies: 0, series: 0 },
  });

function show(id: string, deps: Partial<XtreamSourceFormDeps> = {}) {
  const startInitialSync = vi.fn<XtreamSourceFormDeps['startInitialSync']>(() =>
    Promise.resolve('started'),
  );
  const testSpy = vi.fn(testConnection);
  const view = renderRoutes(
    [
      {
        path: '/settings/sources/:sourceId/edit',
        element: (
          <EditSourceScreen xtreamDeps={{ startInitialSync, testConnection: testSpy, ...deps }} />
        ),
      },
    ],
    `/settings/sources/${id}/edit`,
  );
  media = view.media;
  return { ...view, startInitialSync, testSpy };
}

const field = (label: string) => screen.getByLabelText(label, { exact: false, selector: 'input' });

describe('SRC-08 AC2 — rename', () => {
  it('M3U list: rename, back to My lists, no secret touched', async () => {
    await seedSource(
      makeSource({ id: 'sports', kind: 'm3u-url', name: 'Sports', secretRef: 'source:sports:url' }),
      'https://lists.example.test/s.m3u',
    );
    const { user, router } = show('sports');
    const name = await screen.findByLabelText(text.edit.name, { selector: 'input' });
    expect(name).toHaveValue('Sports');
    // The list address is never shown.
    expect(screen.queryByDisplayValue(/lists\.example\.test/)).toBeNull();
    await user.clear(name);
    await user.type(name, '  Football  ');
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect((await sourcesRepo.get('sports'))?.name).toBe('Football');
    expect(await credentialVault.get('source:sports:url')).toBe('https://lists.example.test/s.m3u');
    expect(await screen.findAllByText(text.myLists.toasts.updated)).not.toHaveLength(0);
  });

  it('Xtream list: a rename alone is applied without a connection test', async () => {
    await seedSource(xtream(), PASS);
    const { user, router, testSpy, startInitialSync } = show('tv');
    const name = await screen.findByRole('textbox', { name: text.fields.name });
    // Prefilled, except the password, which is never shown.
    expect(field(text.fields.server)).toHaveValue(XTREAM_TEST_BASE_URL);
    expect(field(text.fields.username)).toHaveValue(USER);
    expect(field(text.fields.password)).toHaveValue('');
    expect(screen.getByText(text.edit.passwordKeepHelp)).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, 'Bedroom');
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect(testSpy).not.toHaveBeenCalled();
    expect(startInitialSync).not.toHaveBeenCalled();
    expect(await sourcesRepo.get('tv')).toMatchObject({ name: 'Bedroom', username: USER });
    expect(await credentialVault.get(REF)).toBe(PASS);
  });
});

describe('SRC-08 AC2 — Xtream credentials are re-tested before applying', () => {
  it('a new password: tested against the panel, stored in the vault, catalogue re-synced', async () => {
    await seedSource(xtream(), 'old-password');
    const { user, router, testSpy, startInitialSync } = show('tv');
    await user.type(
      await screen.findByLabelText(text.fields.password, { exact: false, selector: 'input' }),
      PASS,
    );
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect(testSpy).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: XTREAM_TEST_BASE_URL, username: USER, password: PASS }),
    );
    expect(await credentialVault.get(REF)).toBe(PASS);
    expect(startInitialSync).toHaveBeenCalledWith('tv');
    expect(await sourcesRepo.get('tv')).toMatchObject({
      name: 'Living room',
      serverUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      secretRef: REF,
    });
    expect(await screen.findAllByText(text.toasts.syncing)).not.toHaveLength(0);
  });

  // Review fix 1: a sync still running with the old settings is stopped before applying, and
  // the toast only claims "loading" when a new sync really started.
  it('a sync running with the old settings is cancelled first, then the edit, then a new sync', async () => {
    await seedSource(xtream(), 'old-password');
    const calls: string[] = [];
    const cancelSync = vi.fn(async () => {
      calls.push('cancel');
    });
    const updateSource = vi.fn(async (input: Parameters<typeof updateXtreamSource>[0]) => {
      calls.push('update');
      await updateXtreamSource(input);
    });
    const { user, router, startInitialSync } = show('tv', { cancelSync, updateSource });
    startInitialSync.mockImplementation(async () => {
      calls.push('sync');
      return 'started';
    });
    await user.type(
      await screen.findByLabelText(text.fields.password, { exact: false, selector: 'input' }),
      PASS,
    );
    await user.click(screen.getByRole('button', { name: text.edit.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect(calls).toEqual(['cancel', 'update', 'sync']);
    expect(cancelSync).toHaveBeenCalledWith('tv');
  });

  it('when no new sync could be started, the toast does not claim channels are loading', async () => {
    await seedSource(xtream(), 'old-password');
    const { user, router, startInitialSync } = show('tv', { cancelSync: async () => undefined });
    startInitialSync.mockResolvedValue('busy');
    await user.type(
      await screen.findByLabelText(text.fields.password, { exact: false, selector: 'input' }),
      PASS,
    );
    await user.click(screen.getByRole('button', { name: text.edit.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect(await screen.findAllByText(text.myLists.toasts.updated)).not.toHaveLength(0);
    expect(screen.queryByText(text.toasts.syncing)).toBeNull();
  });

  it('a failed test applies nothing and explains why (no "save anyway" when editing)', async () => {
    await seedSource(xtream(), PASS);
    const { user, router } = show('tv');
    await user.type(
      await screen.findByLabelText(text.fields.password, { exact: false, selector: 'input' }),
      'wrong-password',
    );
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    expect(await screen.findByTestId('xtream-failure')).toHaveTextContent(
      text.problems['auth-failed'].title,
    );
    expect(screen.queryByRole('button', { name: text.saveAnyway })).toBeNull();
    expect(router.state.location.pathname).toBe('/settings/sources/tv/edit');
    expect(await credentialVault.get(REF)).toBe(PASS);
  });

  it('a new username with an empty password is tested with the stored password', async () => {
    await seedSource(xtream({ username: 'someone-else' }), PASS);
    const { user, router, testSpy } = show('tv');
    const username = await screen.findByRole('textbox', { name: new RegExp(text.fields.username) });
    await user.clear(username);
    await user.type(username, USER);
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/sources'));
    expect(testSpy).toHaveBeenCalledWith(
      expect.objectContaining({ username: USER, password: PASS }),
    );
    expect((await sourcesRepo.get('tv'))?.username).toBe(USER);
    expect(await credentialVault.get(REF)).toBe(PASS);
  });

  it('stored password unreadable → asks to type it again, nothing sent', async () => {
    await seedSource(xtream({ username: 'someone-else' }), PASS);
    const { user, testSpy } = show('tv', { readPassword: () => Promise.resolve(undefined) });
    const username = await screen.findByRole('textbox', { name: new RegExp(text.fields.username) });
    await user.clear(username);
    await user.type(username, USER);
    await user.click(screen.getByRole('button', { name: text.edit.save }));

    expect(await screen.findByText(text.edit.passwordLost)).toBeInTheDocument();
    expect(field(text.fields.password)).toHaveFocus();
    expect(testSpy).not.toHaveBeenCalled();
  });
});

describe('SRC-08 — edit screen states', () => {
  it('unknown list → "List not found" with a way back', async () => {
    show('nope');
    expect(await screen.findByRole('heading', { name: text.edit.notFound.title })).toBeVisible();
    expect(screen.getByRole('link', { name: text.myLists.title })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
  });
});
