// SRC-05 (add M3U list by URL) against MSW + fake-indexeddb + the real vault. The worker task is
// replaced by a direct call to `syncM3uSource` (jsdom has no module workers), with the same
// progress and cancellation contract.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogRepo, settingsRepo, sourcesRepo, vaultStore, wipeAll } from '@/core/db';
import { credentialVault } from '@/core/crypto';
import { clearLogBuffer, clearSecrets } from '@/core/log';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { t } from '@/i18n';
import { syncM3uSource, type SyncM3uResult } from '@/providers/m3u';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { ToastProvider } from '@/ui/state';
import { OnboardingXtreamScreen } from '../AddXtreamScreen';
import { getSourcesPresent, invalidateSourcesPresence } from '../sourcesPresence';
import { M3uUrlForm, formatBytes, type M3uUrlFormDeps } from './M3uUrlForm';
import type { RunM3uImport } from './runM3uImport';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  vi.restoreAllMocks();
  invalidateSourcesPresence();
  clearSecrets();
  clearLogBuffer();
  await wipeAll();
});
afterAll(() => server.close());

const text = t.sources.addM3uUrl;
const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const LIST_URL = 'https://lists.example.test/my/list.m3u';
const LIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="News",One',
  'https://s.example.test/live/1.m3u8',
  '#EXTINF:-1,Two',
  'https://s.example.test/live/2.ts',
  '#EXTINF:-1 group-title="Films",Film',
  'https://s.example.test/movie/3.mp4',
  '#EXTINF:-1,Bad',
  'javascript:alert(1)',
  '',
].join('\n');

/** Same contract as the `syncM3u` worker task, run in this thread. */
const directImport: RunM3uImport = (sourceId, { signal, onProgress }) => {
  let cancelled = signal?.aborted ?? false;
  signal?.addEventListener('abort', () => (cancelled = true));
  const ctx: TaskContext = {
    progress: (p) => onProgress?.(p),
    get cancelled() {
      return cancelled;
    },
    throwIfCancelled() {
      if (cancelled) throw new WorkerTaskError('cancelled');
    },
  };
  return syncM3uSource({ sourceId }, ctx, { cancelPollMs: 5 });
};

function serveList(body: string, { chunk = 1 << 20, pauseMs = 0 } = {}) {
  server.use(
    http.get(LIST_URL, () => {
      const bytes = new TextEncoder().encode(body);
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          if (pauseMs > 0) await delay(pauseMs);
          controller.enqueue(bytes.slice(offset, offset + chunk));
          offset += chunk;
        },
      });
      return new HttpResponse(stream, { headers: { 'content-type': 'audio/x-mpegurl' } });
    }),
  );
}

function Probe() {
  return <h1>Home probe {useLocation().pathname}</h1>;
}

function renderForm(deps: Partial<M3uUrlFormDeps> = {}) {
  const router = createMemoryRouter(
    [
      { path: '*', Component: Probe },
      {
        path: '/onboarding/m3u-url',
        element: (
          <M3uUrlForm
            doneTo="/"
            xtreamTo="/onboarding/xtream"
            deps={{ runImport: directImport, ...deps }}
          />
        ),
      },
      { path: '/onboarding/xtream', Component: OnboardingXtreamScreen },
    ],
    { initialEntries: ['/onboarding/m3u-url'] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router, user: userEvent.setup() };
}

const urlInput = () => screen.getByLabelText(text.fields.url, { exact: false, selector: 'input' });
const nameInput = () =>
  screen.getByLabelText(text.fields.name, { exact: false, selector: 'input' });
const submit = () => screen.getByRole('button', { name: text.submit });

describe('validation', () => {
  it('empty URL → error, focus, nothing saved', async () => {
    const saveSource = vi.fn();
    const { user } = renderForm({ saveSource });
    await user.click(submit());
    expect(urlInput()).toHaveAccessibleDescription(text.validation.urlRequired);
    expect(urlInput()).toHaveFocus();
    expect(saveSource).not.toHaveBeenCalled();
  });

  it.each([
    ['javascript:alert(1)', text.validation.url.scheme],
    ['https://user:secret@lists.example.test/a.m3u', text.validation.url.credentials],
    ['not a url', text.validation.url.invalid],
  ])('%s → the matching message', async (value, message) => {
    const { user } = renderForm();
    await user.type(urlInput(), value);
    await user.click(submit());
    expect(urlInput()).toHaveAccessibleDescription(message);
    expect(await sourcesRepo.list()).toEqual([]);
  });
});

describe('AC2 — get.php URL → Xtream mode suggestion', () => {
  it('offers Xtream mode and prefills the Xtream form without credentials in the location', async () => {
    const { user, router } = renderForm();
    expect(screen.queryByTestId('xtream-suggestion')).toBeNull();
    await user.type(nameInput(), 'Living room');
    await user.type(
      urlInput(),
      `${XTREAM_TEST_BASE_URL}/get.php?username=${USER}&password=${PASS}&type=m3u_plus&output=ts`,
    );
    expect(screen.getByTestId('xtream-suggestion')).toHaveTextContent(text.xtreamSuggestion.title);
    await user.click(screen.getByRole('button', { name: text.xtreamSuggestion.action }));

    expect(
      await screen.findByRole('heading', { name: t.sources.addXtream.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('xtream-prefilled')).toBeInTheDocument();
    const field = (label: string) =>
      screen.getByLabelText(label, { exact: false, selector: 'input' });
    expect(field(t.sources.fields.server)).toHaveValue(XTREAM_TEST_BASE_URL);
    expect(field(t.sources.fields.username)).toHaveValue(USER);
    expect(field(t.sources.fields.password)).toHaveValue(PASS);
    expect(field(t.sources.fields.name)).toHaveValue('Living room');

    // Neither the URL nor the history state carry the credentials (only an opaque id).
    const location = router.state.location;
    expect(location.pathname).toBe('/onboarding/xtream');
    const serialized = JSON.stringify(location) + JSON.stringify(window.history.state);
    expect(serialized).not.toContain(PASS);
    expect(serialized).not.toContain(USER);
    // Nothing was saved by the M3U form.
    expect(await sourcesRepo.list()).toEqual([]);
  });

  it('a plain list URL does not trigger the suggestion', async () => {
    const { user } = renderForm();
    await user.type(urlInput(), `${XTREAM_TEST_BASE_URL}/get.php?username=${USER}`);
    expect(screen.queryByTestId('xtream-suggestion')).toBeNull();
  });
});

describe('AC1 + AC5 — import', () => {
  it('saves the URL in the vault, imports with progress, then Continue → Home', async () => {
    serveList(LIST, { chunk: 24, pauseMs: 30 });
    const { user, router } = renderForm();
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());

    expect(await screen.findByRole('group', { name: text.steps.download })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('m3u-progress-details')).toHaveTextContent(
        text.progress.entries('1'),
      ),
    );

    const title = await screen.findByRole('heading', { name: text.result.title });
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText(text.result.live('2'))).toBeInTheDocument();
    expect(screen.getByText(text.result.movies('1'))).toBeInTheDocument();
    expect(screen.getByText(text.result.skipped('1'))).toBeInTheDocument();

    const [source, ...others] = await sourcesRepo.list();
    expect(others).toEqual([]);
    expect(source).toMatchObject({
      kind: 'm3u-url',
      name: 'lists.example.test',
      secretRef: `source:${source?.id}:url`,
      lastSyncStatus: 'ok',
    });
    // The list URL is only in the vault (encrypted).
    expect(JSON.stringify(source)).not.toContain('/my/list.m3u');
    const raw = await vaultStore.getSecret(source?.secretRef ?? '');
    expect(new TextDecoder().decode(raw?.ciphertext)).not.toContain('list.m3u');
    expect(await credentialVault.get(source?.secretRef ?? '')).toBe(LIST_URL);
    expect(await settingsRepo.get('onboardingDone')).toBe(true);
    expect(await settingsRepo.get('activeSourceId')).toBe(source?.id);
    expect(getSourcesPresent()).toBe(true);

    await user.click(screen.getByRole('button', { name: text.result.continue }));
    expect(await screen.findByRole('heading', { name: 'Home probe /' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() =>
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.toasts.imported),
    );
  });

  it('uses the typed name', async () => {
    serveList(LIST);
    const { user } = renderForm();
    await user.type(nameInput(), '  Family ');
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());
    await screen.findByRole('heading', { name: text.result.title });
    expect((await sourcesRepo.list())[0]?.name).toBe('Family');
  });

  it('Cancel during the download → neutral message, Try again or Delete', async () => {
    serveList(LIST, { chunk: 8, pauseMs: 40 });
    const { user } = renderForm();
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: t.state.cancel }));
    expect(await screen.findByText(t.state.errors.cancelled.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.retry })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.delete })).toBeInTheDocument();
    const [source] = await sourcesRepo.list();
    expect(await catalogRepo.count(source?.id ?? '', 'live')).toBe(0);
  });
});

describe('AC3/AC4 — failures', () => {
  it('blocked (CORS) → actionable message with the local-file suggestion; Delete removes it', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.error()));
    const { user } = renderForm();
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());

    const failure = await screen.findByTestId('m3u-failure');
    expect(failure).toHaveTextContent(t.sources.problems['blocked-cors'].title);
    expect(failure).toHaveTextContent(t.sources.fixes['use-local-file']);
    expect(failure).toHaveTextContent(text.localFileSoon);
    await waitFor(() => expect(failure).toHaveFocus());
    // The fields are locked while the saved list is pending a decision.
    expect(urlInput()).toBeDisabled();

    const [source] = await sourcesRepo.list();
    expect(source).toMatchObject({ lastSyncStatus: 'error', lastSyncError: 'blocked' });

    await user.click(screen.getByRole('button', { name: text.delete }));
    await waitFor(() => expect(screen.queryByTestId('m3u-failure')).toBeNull());
    expect(await sourcesRepo.list()).toEqual([]);
    expect(await vaultStore.getSecret(source?.secretRef ?? '')).toBeUndefined();
    expect(urlInput()).toBeEnabled();
    expect(urlInput()).toHaveValue(LIST_URL);
    await waitFor(() =>
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.toasts.deleted),
    );
  });

  it('mixed content → its own message with the HTTPS and local-file suggestions', async () => {
    const runImport = vi.fn<RunM3uImport>((sourceId) =>
      Promise.resolve<SyncM3uResult>({
        sourceId,
        status: 'error',
        error: 'blocked',
        hint: 'mixed-content',
        stats: { live: 0, movies: 0, series: 0 },
        entries: 0,
        skipped: 0,
        skippedByReason: {} as SyncM3uResult['skippedByReason'],
        bytes: 0,
        epgUrls: 0,
      }),
    );
    const { user } = renderForm({ runImport });
    await user.type(urlInput(), 'http://lists.example.test/a.m3u');
    await user.click(submit());
    const failure = await screen.findByTestId('m3u-failure');
    expect(failure).toHaveTextContent(t.sources.problems['blocked-mixed-content'].title);
    expect(failure).toHaveTextContent(t.sources.fixes['use-https']);
    expect(failure).toHaveTextContent(t.sources.fixes['use-local-file']);
    expect(runImport).toHaveBeenCalledOnce();
  });

  it('an HTML page → "The URL did not return an M3U list"; Try again imports once fixed', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.html('<!doctype html><p>Login</p>')));
    const { user } = renderForm();
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());
    const failure = await screen.findByTestId('m3u-failure');
    expect(failure).toHaveTextContent(text.errors['not-m3u'].message);

    server.resetHandlers();
    serveList(LIST);
    await user.click(screen.getByRole('button', { name: text.retry }));
    expect(await screen.findByRole('heading', { name: text.result.title })).toBeInTheDocument();
    expect(await sourcesRepo.list()).toHaveLength(1);
  });

  it('HTTP 404 → the status in the message', async () => {
    server.use(http.get(LIST_URL, () => new HttpResponse('nope', { status: 404 })));
    const { user } = renderForm();
    await user.type(urlInput(), LIST_URL);
    await user.click(submit());
    expect(await screen.findByTestId('m3u-failure')).toHaveTextContent(
      t.state.errors.net.httpStatus('404'),
    );
  });
});

describe('formatBytes', () => {
  it('KB below 1 MB, MB with one decimal above', () => {
    expect(formatBytes(1500)).toBe(text.units.kb('2'));
    expect(formatBytes(5 * 1024 * 1024 + 300_000)).toBe(text.units.mb('5.3'));
  });
});
