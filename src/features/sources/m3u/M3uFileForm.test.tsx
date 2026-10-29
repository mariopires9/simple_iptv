// SRC-06 (add a local M3U file) against fake-indexeddb + the real catalogue write. The worker task
// is replaced by a direct call to `syncM3uFileSource` (jsdom has no module workers), with the same
// progress and cancellation contract; the picked `File` is handed over as the worker would get it.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogRepo, settingsRepo, sourcesRepo, vaultStore, wipeAll } from '@/core/db';
import { clearLogBuffer } from '@/core/log';
import { WorkerTaskError, type TaskContext } from '@/core/worker';
import { t } from '@/i18n';
import { syncM3uFileSource, waitForM3uSourceIdle } from '@/providers/m3u';
import { formatBytes } from '@/ui/format';
import { ToastProvider } from '@/ui/state';
import { invalidateSourcesPresence } from '../sourcesPresence';
import { M3U_FILE_ACCEPT } from './filePicker';
import { M3uFileForm, type M3uFileFormDeps } from './M3uFileForm';
import type { RunM3uFileImport, SettleM3uImport } from './runM3uImport';
import { saveM3uFileSource } from './saveM3uFileSource';

afterEach(async () => {
  vi.restoreAllMocks();
  invalidateSourcesPresence();
  clearLogBuffer();
  await wipeAll();
});

const text = t.sources.addM3uFile;
const urlText = t.sources.addM3uUrl;
const LIST = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="News",One',
  'https://s.example.test/live/1.m3u8',
  '#EXTINF:-1,Two',
  'https://s.example.test/live/2.ts',
  '#EXTINF:-1 group-title="Films",Film',
  'https://s.example.test/movie/3.mp4',
  '',
].join('\n');

/**
 * A picked file. jsdom's `File` may lack `stream()`: it is given one over the same bytes, read in
 * small chunks with a pause so progress and cancellation can be observed.
 */
function m3uFile(body: string, name = 'My Channels.m3u', { chunk = 1 << 20, pauseMs = 0 } = {}) {
  const file = new File([body], name, { type: 'audio/x-mpegurl' });
  const bytes = new TextEncoder().encode(body);
  file.stream = () => {
    let offset = 0;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + chunk));
        offset += chunk;
      },
    });
  };
  return file;
}

/** Same contract as the `syncM3uFile` worker task, run in this thread. */
const directImport: RunM3uFileImport = (sourceId, file, { signal, onProgress }) => {
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
  const run = syncM3uFileSource({ sourceId, file }, ctx, { cancelPollMs: 5 });
  // Like the worker client: an abort rejects at once.
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new WorkerTaskError('cancelled')));
    run.then(resolve, reject);
  });
};

const directSettle: SettleM3uImport = async (sourceId) => {
  await waitForM3uSourceIdle(sourceId);
  return sourcesRepo.get(sourceId);
};

function Probe() {
  return <h1>Home probe {useLocation().pathname}</h1>;
}

function renderForm(deps: Partial<M3uFileFormDeps> = {}) {
  const router = createMemoryRouter(
    [
      { path: '*', Component: Probe },
      {
        path: '/onboarding/m3u-file',
        element: (
          <M3uFileForm
            doneTo="/"
            deps={{ runImport: directImport, settleImport: directSettle, ...deps }}
          />
        ),
      },
    ],
    { initialEntries: ['/onboarding/m3u-file'] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router, user: userEvent.setup() };
}

const fileInput = () => screen.getByTestId<HTMLInputElement>('m3u-file-input');
const submit = () => screen.getByRole('button', { name: text.submit });
const nameInput = () =>
  screen.getByLabelText(text.fields.name, { exact: false, selector: 'input' });

describe('AC1 — pick a file and import it through the streaming parser', () => {
  it('offers M3U files only; imports with progress; no URL, nothing in the vault; Home', async () => {
    const { user, router } = renderForm();
    expect(fileInput()).toHaveAttribute('accept', M3U_FILE_ACCEPT);
    expect(M3U_FILE_ACCEPT).toBe('.m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl');
    expect(screen.getByTestId('m3u-file-chosen')).toHaveTextContent(text.fields.none);

    const file = m3uFile(LIST, 'My Channels.m3u', { chunk: 40, pauseMs: 15 });
    await user.upload(fileInput(), file);
    expect(screen.getByTestId('m3u-file-chosen')).toHaveTextContent(
      text.fields.chosen('My Channels.m3u', formatBytes(file.size)),
    );
    expect(screen.getByRole('button', { name: text.fields.change })).toBeInTheDocument();

    await user.click(submit());
    expect(await screen.findByRole('group', { name: text.steps.read })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('m3u-progress-details')).toHaveTextContent(/read/),
    );

    const heading = await screen.findByRole('heading', { name: urlText.result.title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(urlText.result.live('2'))).toBeInTheDocument();
    expect(screen.getByText(urlText.result.movies('1'))).toBeInTheDocument();

    const [source] = await sourcesRepo.list();
    expect(source).toMatchObject({ kind: 'm3u-file', name: 'My Channels', lastSyncStatus: 'ok' });
    expect(source?.secretRef).toBeUndefined();
    expect(await vaultStore.getSecret(`source:${source?.id ?? ''}:url`)).toBeUndefined();
    expect(await catalogRepo.count(source?.id ?? '', 'live')).toBe(2);
    expect(await settingsRepo.get('onboardingDone')).toBe(true);
    expect(await settingsRepo.get('activeSourceId')).toBe(source?.id);
    // The file is not stored anywhere: only the parsed catalogue (rows hold no file content).
    expect(JSON.stringify(source)).not.toContain('#EXTM3U');

    await user.click(screen.getByRole('button', { name: urlText.result.continue }));
    expect(await screen.findByRole('heading', { name: 'Home probe /' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('uses the typed name instead of the file name', async () => {
    const { user } = renderForm();
    await user.upload(fileInput(), m3uFile(LIST));
    await user.type(nameInput(), 'Kitchen');
    await user.click(submit());
    await screen.findByRole('heading', { name: urlText.result.title });
    expect((await sourcesRepo.list())[0]?.name).toBe('Kitchen');
  });

  it('a double submit saves and imports one list only', async () => {
    const saveSource = vi.fn(saveM3uFileSource);
    const { user } = renderForm({ saveSource });
    await user.upload(fileInput(), m3uFile(LIST));
    const form = submit().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByRole('heading', { name: urlText.result.title });
    expect(saveSource).toHaveBeenCalledTimes(1);
    expect(await sourcesRepo.list()).toHaveLength(1);
  });

  it('Import without a file → "Choose a file." and the picker button gets the focus', async () => {
    const { user } = renderForm();
    await user.click(submit());
    expect(screen.getByText(text.validation.fileRequired)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.fields.choose })).toHaveFocus();
    expect(await sourcesRepo.list()).toEqual([]);
  });

  it('Cancel while reading → nothing imported; Try again and Delete are offered', async () => {
    const { user } = renderForm();
    const long = `${LIST}${LIST.split('\n').slice(1).join('\n').repeat(30)}`;
    await user.upload(fileInput(), m3uFile(long, 'long.m3u', { chunk: 16, pauseMs: 20 }));
    await user.click(submit());
    await screen.findByRole('group', { name: text.steps.read });
    await user.click(screen.getByRole('button', { name: t.state.cancel }));
    expect(await screen.findByText(t.state.errors.cancelled.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: urlText.retry })).toBeInTheDocument();
    const [source] = await sourcesRepo.list();
    expect(await catalogRepo.count(source?.id ?? '', 'live')).toBe(0);
  });
});

describe('AC2 — files over 50 MB need a confirmation', () => {
  function bigFile() {
    const file = m3uFile(LIST, 'huge.m3u');
    Object.defineProperty(file, 'size', { value: 120_000_000 });
    return file;
  }

  it('Cancel in the warning saves nothing', async () => {
    const { user } = renderForm();
    await user.upload(fileInput(), bigFile());
    await user.click(submit());
    const dialog = await screen.findByRole('dialog', { name: text.largeFile.title });
    expect(dialog).toHaveTextContent(text.largeFile.message(formatBytes(120_000_000)));
    await user.click(within(dialog).getByRole('button', { name: t.state.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await sourcesRepo.list()).toEqual([]);
  });

  it('"Import anyway" imports it', async () => {
    const { user } = renderForm();
    await user.upload(fileInput(), bigFile());
    await user.click(submit());
    const dialog = await screen.findByRole('dialog', { name: text.largeFile.title });
    await user.click(within(dialog).getByRole('button', { name: text.largeFile.confirm }));
    expect(await screen.findByRole('heading', { name: urlText.result.title })).toBeInTheDocument();
  });

  it('a file of 50 MB or less is imported without asking', async () => {
    const { user } = renderForm();
    const file = m3uFile(LIST);
    Object.defineProperty(file, 'size', { value: 50_000_000 });
    await user.upload(fileInput(), file);
    await user.click(submit());
    expect(await screen.findByRole('heading', { name: urlText.result.title })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('failures', () => {
  it('not an M3U file → message; another file + Try again imports into the same list', async () => {
    const { user } = renderForm();
    await user.upload(fileInput(), m3uFile('<html>nope</html>', 'page.m3u'));
    await user.click(submit());
    const failure = await screen.findByTestId('m3u-failure');
    expect(failure).toHaveTextContent(text.errors['not-m3u'].message);
    await waitFor(() => expect(failure).toHaveFocus());
    // The name is locked once the list is saved; the file can still be changed.
    expect(nameInput()).toBeDisabled();

    await user.upload(fileInput(), m3uFile(LIST, 'good.m3u'));
    await user.click(within(failure).getByRole('button', { name: urlText.retry }));
    expect(await screen.findByRole('heading', { name: urlText.result.title })).toBeInTheDocument();
    const sources = await sourcesRepo.list();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ name: 'page', lastSyncStatus: 'ok' });
  });

  it('an unreadable file → "Could not read the file"; Delete removes the saved list', async () => {
    const { user } = renderForm();
    const file = m3uFile(LIST);
    file.stream = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
          controller.error(new DOMException('gone', 'NotReadableError'));
        },
      });
    await user.upload(fileInput(), file);
    await user.click(submit());
    const failure = await screen.findByTestId('m3u-failure');
    expect(failure).toHaveTextContent(text.errors['file-unreadable'].title);
    await user.click(within(failure).getByRole('button', { name: urlText.delete }));
    await waitFor(() => expect(screen.queryByTestId('m3u-failure')).toBeNull());
    expect(await sourcesRepo.list()).toEqual([]);
  });

  it('saving the list fails → error, nothing imported', async () => {
    const saveSource = vi.fn(() => Promise.reject(new Error('quota')));
    const runImport = vi.fn(directImport);
    const { user } = renderForm({ saveSource, runImport });
    await user.upload(fileInput(), m3uFile(LIST));
    await user.click(submit());
    expect(await screen.findByTestId('m3u-failure')).toBeInTheDocument();
    expect(runImport).not.toHaveBeenCalled();
  });
});
