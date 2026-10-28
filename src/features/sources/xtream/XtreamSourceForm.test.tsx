// SRC-03 (add Xtream source) + UX-01 AC3 against the synthetic MSW panel (QA-01) and
// fake-indexeddb: validation, test steps, saving (vault + source row), failures, mixed content,
// cancellation and the password field's accessibility.
import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { settingsRepo, sourcesRepo, vaultStore, wipeAll } from '@/core/db';
import { credentialVault } from '@/core/crypto';
import { clearLogBuffer, clearSecrets } from '@/core/log';
import { t } from '@/i18n';
import { testConnection } from '@/providers/xtream';
import { XTREAM_TEST_BASE_URL, XTREAM_TEST_CREDENTIALS, xtreamHandlers } from '@/test/msw';
import { createMswServer } from '@/test/msw/server';
import { ToastProvider } from '@/ui/state';
import { getSourcesPresent, invalidateSourcesPresence } from '../sourcesPresence';
import { XtreamSourceForm, type XtreamSourceFormDeps } from './XtreamSourceForm';

const server = createMswServer(...xtreamHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  invalidateSourcesPresence();
  clearSecrets();
  clearLogBuffer();
  await wipeAll();
});
afterAll(() => server.close());

const { username: USER, password: PASS } = XTREAM_TEST_CREDENTIALS;
const text = t.sources;

function HomeProbe() {
  return <h1>Home probe {useLocation().pathname}</h1>;
}

function renderForm(deps: Partial<XtreamSourceFormDeps> = {}, doneTo = '/') {
  const startInitialSync = vi.fn<XtreamSourceFormDeps['startInitialSync']>(() =>
    Promise.resolve('started'),
  );
  const router = createMemoryRouter(
    [
      { path: '*', Component: HomeProbe },
      {
        path: '/onboarding/xtream',
        element: <XtreamSourceForm doneTo={doneTo} deps={{ startInitialSync, ...deps }} />,
      },
    ],
    { initialEntries: ['/onboarding/xtream'] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router, startInitialSync, user: userEvent.setup() };
}

const field = (label: string) => screen.getByLabelText(label, { exact: false, selector: 'input' });
const serverInput = () => field(text.fields.server);
const usernameInput = () => field(text.fields.username);
const passwordInput = () => field(text.fields.password);
const submit = () => screen.getByRole('button', { name: text.submit });

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  values: { server?: string; username?: string; password?: string; name?: string },
) {
  if (values.name !== undefined) await user.type(field(text.fields.name), values.name);
  if (values.server !== undefined) await user.type(serverInput(), values.server);
  if (values.username !== undefined) await user.type(usernameInput(), values.username);
  if (values.password !== undefined) await user.type(passwordInput(), values.password);
}

describe('SRC-03 AC1 — validation', () => {
  it('empty fields → per-field errors, focus on the first one (server), nothing sent', async () => {
    const testSpy = vi.fn(testConnection);
    const { user } = renderForm({ testConnection: testSpy });
    await user.click(submit());

    expect(serverInput()).toHaveAccessibleDescription(text.validation.serverRequired);
    expect(usernameInput()).toHaveAccessibleDescription(text.validation.usernameRequired);
    expect(passwordInput()).toHaveAccessibleDescription(text.validation.passwordRequired);
    for (const input of [serverInput(), usernameInput(), passwordInput()]) {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    expect(field(text.fields.name)).toHaveAttribute('aria-invalid', 'false');
    expect(serverInput()).toHaveFocus();
    expect(testSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['javascript:alert(1)', text.validation.serverUrl.scheme],
    ['http://user:secret@panel.example.test', text.validation.serverUrl.credentials],
    ['http://exa mple', text.validation.serverUrl.invalid],
  ])('invalid server URL %s → the matching message', async (server, message) => {
    const { user } = renderForm();
    await fill(user, { server, username: USER, password: PASS });
    await user.click(submit());
    expect(serverInput()).toHaveAccessibleDescription(message);
    expect(serverInput()).toHaveFocus();
  });

  it('focuses the first invalid field in screen order (username)', async () => {
    const { user } = renderForm();
    await fill(user, { server: 'panel.example.test:8080' });
    await user.click(submit());
    expect(usernameInput()).toHaveFocus();
    expect(serverInput()).toHaveAttribute('aria-invalid', 'false');
  });

  it('typing in a field clears its error', async () => {
    const { user } = renderForm();
    await user.click(submit());
    await user.type(usernameInput(), 'x');
    expect(usernameInput()).toHaveAttribute('aria-invalid', 'false');
  });
});

describe('SRC-03 AC2 + UX-01 AC3 — test and save', () => {
  it('shows the steps, saves (vault + source), sets onboardingDone, starts the sync, goes Home', async () => {
    server.use(...xtreamHandlers({ delayMs: 50 }));
    const { user, router, startInitialSync } = renderForm();
    await fill(user, { server: 'panel.example.test:8080/', username: USER, password: PASS });
    await user.click(submit());

    // Test steps in a progress panel (live region announces the phase).
    expect(await screen.findByRole('group', { name: text.steps.contacting })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: text.result.title })).toHaveFocus();

    // Account info (status, expiry formatted in the active locale, connections) + http warning.
    expect(screen.getByText(text.result.status('Active'))).toBeInTheDocument();
    const expiry = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(1893456000 * 1000);
    expect(screen.getByText(text.result.expires(expiry))).toBeInTheDocument();
    expect(screen.getByText(text.result.connections('0', '2'))).toBeInTheDocument();
    expect(screen.getByText(text.problems['http-only'].title)).toBeInTheDocument();
    expect(screen.getByText(text.fixes['see-connection-options'])).toBeInTheDocument();

    // Source row: no secret in it; name defaults to the host; https not available → http base.
    const [source, ...others] = await sourcesRepo.list();
    expect(others).toEqual([]);
    expect(source).toMatchObject({
      kind: 'xtream',
      name: 'panel.example.test',
      serverUrl: XTREAM_TEST_BASE_URL,
      username: USER,
      secretRef: `source:${source?.id}:password`,
      prefs: { liveFormat: 'auto' },
      lastSyncStatus: 'never',
      stats: { live: 0, movies: 0, series: 0 },
    });
    expect(JSON.stringify(source)).not.toContain(PASS);

    // Vault: the raw secrets row holds only ciphertext; the vault decrypts it back.
    const ref = source?.secretRef ?? '';
    const raw = await vaultStore.getSecret(ref);
    expect(raw).toBeDefined();
    expect(Object.keys(raw ?? {}).sort()).toEqual(['ciphertext', 'iv', 'kid', 'ref']);
    const bytes = new TextDecoder('utf-8', { fatal: false }).decode(raw?.ciphertext);
    expect(bytes).not.toContain(PASS);
    expect(await credentialVault.get(ref)).toBe(PASS);

    expect(await settingsRepo.get('onboardingDone')).toBe(true);
    expect(await settingsRepo.get('activeSourceId')).toBe(source?.id);
    expect(getSourcesPresent()).toBe(true);
    expect(startInitialSync).toHaveBeenCalledExactlyOnceWith(source?.id);

    await user.click(screen.getByRole('button', { name: text.result.continue }));
    expect(await screen.findByRole('heading', { name: 'Home probe /' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() =>
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.toasts.syncing),
    );
  });

  it('uses the typed name and the HTTPS base when the panel offers it', async () => {
    server.use(
      ...xtreamHandlers({ auth: 'ok-https' }),
      ...xtreamHandlers({ baseUrl: 'https://panel.example.test:8443', auth: 'ok-https' }),
    );
    const { user } = renderForm();
    await fill(user, {
      name: '  Living room ',
      server: 'http://panel.example.test:8080',
      username: USER,
      password: PASS,
    });
    await user.click(submit());
    await screen.findByRole('heading', { name: text.result.title });
    const [source] = await sourcesRepo.list();
    expect(source).toMatchObject({
      name: 'Living room',
      serverUrl: 'https://panel.example.test:8443',
    });
    expect(screen.queryByText(text.problems['http-only'].title)).toBeNull();
  });

  it('a failing initial sync never blocks saving', async () => {
    const { user } = renderForm({ startInitialSync: () => new Promise(() => undefined) });
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    expect(await screen.findByRole('heading', { name: text.result.title })).toBeInTheDocument();
    expect(await sourcesRepo.list()).toHaveLength(1);
  });
});

describe('SRC-03 AC3 — failures keep the form data', () => {
  it('wrong password → mapped message + suggested fix; fields keep their values; nothing saved', async () => {
    const { user } = renderForm();
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: 'wrong' });
    await user.click(submit());

    const failure = await screen.findByTestId('xtream-failure');
    expect(within(failure).getByRole('alert')).toHaveTextContent(
      text.problems['auth-failed'].title,
    );
    expect(within(failure).getByText(text.problems['auth-failed'].message)).toBeInTheDocument();
    expect(within(failure).getByText(text.fixes['check-credentials'])).toBeInTheDocument();
    expect(within(failure).queryByRole('button', { name: text.saveAnyway })).toBeNull();
    expect(failure).toHaveFocus();
    // Details are redacted: the password never appears on screen.
    expect(document.body.textContent).not.toContain('wrong');

    expect(serverInput()).toHaveValue('panel.example.test:8080');
    expect(usernameInput()).toHaveValue(USER);
    expect(passwordInput()).toHaveValue('wrong');
    expect(await sourcesRepo.list()).toEqual([]);
    expect(await settingsRepo.get('onboardingDone')).toBeUndefined();

    // "Try again" with the corrected password succeeds.
    await user.clear(passwordInput());
    await user.type(passwordInput(), PASS);
    await user.click(within(failure).getByRole('button', { name: t.state.actions.retry }));
    expect(await screen.findByRole('heading', { name: text.result.title })).toBeInTheDocument();
  });

  it('server error → message, fix and redacted details', async () => {
    server.use(...xtreamHandlers({ error: 'http-500' }));
    const { user } = renderForm();
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    const failure = await screen.findByTestId('xtream-failure');
    expect(within(failure).getByText(text.problems['http-error'].title)).toBeInTheDocument();
    expect(within(failure).getByText(text.fixes['retry-later'])).toBeInTheDocument();
    expect(within(failure).getByText(t.state.details)).toBeInTheDocument();
    expect(failure.textContent).not.toContain(PASS);
  });

  it('a storage failure while saving → describeError message, data kept', async () => {
    const { user } = renderForm({
      saveSource: () => Promise.reject(Object.assign(new Error('x'), { name: 'Boom' })),
    });
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    const failure = await screen.findByTestId('xtream-failure');
    expect(within(failure).getByText(t.state.errors.unknown.title)).toBeInTheDocument();
    expect(passwordInput()).toHaveValue(PASS);
  });
});

describe('SRC-03 AC5 — HTTP-only / mixed content', () => {
  it('blocked as mixed content (no HTTPS) → warning with fixes, then "Save anyway"', async () => {
    vi.stubGlobal('location', { ...window.location, protocol: 'https:' });
    server.use(...xtreamHandlers({ baseUrl: '*', error: 'network' }));
    const { user, startInitialSync } = renderForm();
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());

    const failure = await screen.findByTestId('xtream-failure');
    expect(
      within(failure).getByText(text.problems['blocked-mixed-content'].title),
    ).toBeInTheDocument();
    for (const fix of ['use-https', 'use-local-file', 'use-proxy'] as const) {
      expect(within(failure).getByText(text.fixes[fix])).toBeInTheDocument();
    }
    expect(within(failure).getByText(text.saveAnywayHint)).toBeInTheDocument();
    expect(await sourcesRepo.list()).toEqual([]);

    await user.click(within(failure).getByRole('button', { name: text.saveAnyway }));
    expect(await screen.findByRole('heading', { name: 'Home probe /' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.toasts.savedWithError),
    );

    const [source] = await sourcesRepo.list();
    expect(source).toMatchObject({
      serverUrl: XTREAM_TEST_BASE_URL,
      lastSyncStatus: 'error',
      lastSyncError: 'blocked-mixed-content',
    });
    expect(await credentialVault.get(source?.secretRef ?? '')).toBe(PASS);
    expect(await settingsRepo.get('onboardingDone')).toBe(true);
    // Nothing to sync from this page.
    expect(startInitialSync).not.toHaveBeenCalled();
  });

  it('authenticated over HTTP from an http page → saved, with an HTTP-only warning', async () => {
    const { user } = renderForm();
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    await screen.findByRole('heading', { name: text.result.title });
    expect(screen.getByTestId('warning-http-only')).toHaveTextContent(
      text.problems['http-only'].message,
    );
    expect(screen.queryByRole('button', { name: text.saveAnyway })).toBeNull();
    expect(await sourcesRepo.list()).toHaveLength(1);
  });
});

describe('SRC-03 — cancel', () => {
  it('"Cancel" aborts the test in flight and returns to the form without an error', async () => {
    server.use(...xtreamHandlers({ error: 'timeout' }));
    const testSpy = vi.fn(testConnection);
    const { user } = renderForm({ testConnection: testSpy });
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());

    const panel = await screen.findByRole('group', { name: text.steps.contacting });
    await user.click(within(panel).getByRole('button', { name: t.state.cancel }));

    expect(await screen.findByRole('button', { name: text.submit })).toBeEnabled();
    const signal = testSpy.mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('xtream-failure')).toBeNull();
    expect(passwordInput()).toHaveValue(PASS);
    expect(await sourcesRepo.list()).toEqual([]);
  });
});

describe('SRC-03 AC4 — field attributes and the password toggle', () => {
  it('autocomplete, inputmode, autocapitalize and spellcheck', () => {
    renderForm();
    expect(passwordInput()).toHaveAttribute('autocomplete', 'current-password');
    expect(passwordInput()).toHaveAttribute('type', 'password');
    expect(usernameInput()).toHaveAttribute('autocomplete', 'username');
    expect(serverInput()).toHaveAttribute('inputmode', 'url');
    expect(serverInput()).toHaveAttribute('autocapitalize', 'off');
    expect(serverInput()).toHaveAttribute('spellcheck', 'false');
  });

  it('show/hide toggle: accessible name, aria-pressed, keyboard operable', async () => {
    const { user } = renderForm();
    await user.type(passwordInput(), PASS);
    const toggle = screen.getByRole('button', { name: text.fields.showPassword });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(passwordInput()).toHaveAttribute('type', 'text');
    expect(passwordInput()).toHaveValue(PASS);

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(passwordInput()).toHaveAttribute('type', 'password'));
  });
});

// Review findings: destination after saving, unmount during save, honest syncing toast.
describe('SRC-03 — after saving', () => {
  const MY_LISTS = '/settings/sources';
  const politeToast = () => screen.getByTestId('toast-polite');

  it('Continue goes to the caller destination (My lists)', async () => {
    const { user, router } = renderForm({}, MY_LISTS);
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: text.result.continue }));
    expect(await screen.findByRole('heading', { name: `Home probe ${MY_LISTS}` })).toBeVisible();
    expect(router.state.location.pathname).toBe(MY_LISTS);
  });

  it('"Save anyway" goes to the caller destination (My lists)', async () => {
    vi.stubGlobal('location', { ...window.location, protocol: 'https:' });
    server.use(...xtreamHandlers({ baseUrl: '*', error: 'network' }));
    const { user, router } = renderForm({}, MY_LISTS);
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: text.saveAnyway }));
    await screen.findByRole('heading', { name: `Home probe ${MY_LISTS}` });
    expect(router.state.location.pathname).toBe(MY_LISTS);
  });

  it('the sync could not be started → neutral "List saved" toast, not "Loading…"', async () => {
    const { user } = renderForm({ startInitialSync: () => Promise.resolve('unavailable') });
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: text.result.continue }));
    await screen.findByRole('heading', { name: 'Home probe /' });
    await waitFor(() => expect(politeToast()).toHaveTextContent(text.toasts.saved));
    expect(politeToast()).not.toHaveTextContent(text.toasts.syncing);
  });

  it('leaving the screen during "Save anyway": the save completes, no toast, no navigation', async () => {
    vi.stubGlobal('location', { ...window.location, protocol: 'https:' });
    server.use(...xtreamHandlers({ baseUrl: '*', error: 'network' }));
    let finishSave: (() => void) | undefined;
    const saveSource = vi.fn<XtreamSourceFormDeps['saveSource']>(
      (input) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              id: 's1',
              kind: 'xtream',
              name: input.host,
              prefs: { liveFormat: 'auto' },
              createdAt: 1,
              lastSyncStatus: 'error',
              stats: { live: 0, movies: 0, series: 0 },
            });
        }),
    );
    const { user, router } = renderForm({ saveSource });
    await fill(user, { server: 'panel.example.test:8080', username: USER, password: PASS });
    await user.click(submit());
    await user.click(await screen.findByRole('button', { name: text.saveAnyway }));
    await waitFor(() => expect(saveSource).toHaveBeenCalledTimes(1));

    await act(() => router.navigate('/elsewhere'));
    await screen.findByRole('heading', { name: 'Home probe /elsewhere' });
    await act(async () => finishSave?.());

    expect(router.state.location.pathname).toBe('/elsewhere');
    expect(politeToast()).toBeEmptyDOMElement();
  });
});
