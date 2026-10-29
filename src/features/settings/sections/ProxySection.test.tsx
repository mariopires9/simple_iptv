// PRX-01 AC1 — Settings › Personal proxy: address + token (token in the vault), Test connection
// outcomes (MSW stands in for the proxy), per-list routing (default Off) and Remove.
// Synthetic hosts and tokens only.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { settingsRepo, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { forgetActiveSource, PROXY_TOKEN_REF, savePersonalProxy } from '@/core/session';
import { t } from '@/i18n';
import { createMswServer } from '@/test/msw/server';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { renderSettings } from '../test-utils';
import { ProxySection } from './ProxySection';

const text = t.settings.proxy;
const PROXY = 'https://pc.example.test';
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const PANEL = 'http://panel.example.test:8080';

const health = (extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ service: 'simple-iptv-proxy', api: 1, activeUpstreams: 3, ...extra });

const requests: string[] = [];
const server = createMswServer(
  http.get(`${PROXY}/v1/:token/health`, ({ params, request }) => {
    requests.push(request.url);
    return params.token === TOKEN
      ? health()
      : new HttpResponse(null, { status: 401, headers: { 'X-Simple-Iptv-Proxy-Error': 'auth' } });
  }),
  http.get(`${PROXY}/v1/:token/health/:probe`, ({ params, request }) => {
    requests.push(request.url);
    const probe = Buffer.from(String(params.probe), 'base64url').toString('utf8');
    return health({ upstreamAllowed: probe === `${PANEL}/` });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const list = (id: string, extra: Partial<Source> = {}): Source => ({
  id,
  kind: 'xtream',
  name: `List ${id}`,
  serverUrl: PANEL,
  username: 'demo',
  prefs: { liveFormat: 'auto' },
  createdAt: id === 'a' ? 1 : 2,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
  ...extra,
});

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
  requests.length = 0;
});
afterEach(async () => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  media.restore();
  forgetActiveSource();
  clearSecrets();
  await wipeAll();
});

const urlField = () => screen.findByLabelText(text.url);
const tokenField = () => screen.getByLabelText(text.token);

async function fill(user: ReturnType<typeof userEvent.setup>, url: string, token: string) {
  const urlInput = await urlField();
  await user.clear(urlInput);
  if (url) await user.type(urlInput, url);
  await user.clear(tokenField());
  if (token) await user.type(tokenField(), token);
}

/** The test result (an `alert`, announced when it appears). */
const status = () => screen.getByTestId('proxy-test-result');

describe('ProxySection (PRX-01 AC1)', () => {
  it('defaults: empty, every list Off and disabled until a proxy is saved; labelled fields', async () => {
    await sourcesRepo.put(list('a'));
    await sourcesRepo.put(list('b', { prefs: { liveFormat: 'auto', proxy: 'all' } }));
    renderSettings(<ProxySection />);
    expect(await urlField()).toHaveValue('');
    expect(await urlField()).toHaveAccessibleDescription(text.urlHint);
    expect(tokenField()).toHaveAttribute('type', 'password');
    expect(tokenField()).toHaveAccessibleDescription(text.tokenHint);
    const a = screen.getByLabelText(text.routing.label('List a'));
    expect(a).toHaveValue('off');
    expect(a).toBeDisabled();
    expect(a).toHaveAccessibleDescription(text.routing.disabledHint);
    expect(screen.getByLabelText(text.routing.label('List b'))).toBeDisabled();
    expect(screen.queryByRole('button', { name: text.remove })).toBeNull();

    const reveal = screen.getByRole('button', { name: text.showToken });
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(reveal);
    expect(tokenField()).toHaveAttribute('type', 'text');
    expect(reveal).toHaveAttribute('aria-pressed', 'true');
  });

  it('validation: the address must be https and the token well formed; nothing is saved', async () => {
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    await fill(user, 'http://pc.example.test', 'short');
    await user.click(screen.getByRole('button', { name: text.save }));
    expect(await urlField()).toHaveAccessibleDescription(text.errors.baseUrl.insecure);
    expect(await urlField()).toHaveAttribute('aria-invalid', 'true');
    expect(tokenField()).toHaveAccessibleDescription(text.errors.token.invalid);
    await fill(user, '', '');
    await user.click(screen.getByRole('button', { name: text.test }));
    await waitFor(async () =>
      expect(await urlField()).toHaveAccessibleDescription(text.errors.baseUrl.empty),
    );
    expect(tokenField()).toHaveAccessibleDescription(text.errors.token.required);
    expect(requests).toEqual([]);
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
  });

  it('save: address in the settings, token in the vault; the token is never shown back', async () => {
    await sourcesRepo.put(list('a'));
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    await fill(user, 'https://PC.example.test/', TOKEN);
    await user.click(screen.getByRole('button', { name: text.save }));
    await waitFor(() => expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.saved));
    expect(await settingsRepo.get('personalProxy')).toEqual({ baseUrl: PROXY });
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBe(TOKEN);
    expect(await urlField()).toHaveValue(PROXY);
    expect(tokenField()).toHaveValue('');
    expect(tokenField()).toHaveAccessibleDescription(text.tokenKeep);
    // Lists can now be routed; still Off until the user chooses.
    const select = screen.getByLabelText(text.routing.label('List a'));
    expect(select).toBeEnabled();
    expect(select).toHaveValue('off');
    expect((await sourcesRepo.get('a'))?.prefs.proxy).toBeUndefined();
  });

  it('per-list routing persists prefs.proxy (Off removes it)', async () => {
    await sourcesRepo.put(list('a'));
    await savePersonalProxy({ baseUrl: PROXY, token: TOKEN });
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    const select = await screen.findByLabelText(text.routing.label('List a'));
    expect(select).toHaveAccessibleDescription(text.routing.hint);
    await user.selectOptions(select, 'streams');
    await waitFor(async () => expect((await sourcesRepo.get('a'))?.prefs.proxy).toBe('streams'));
    await user.selectOptions(select, 'all');
    await waitFor(async () => expect((await sourcesRepo.get('a'))?.prefs.proxy).toBe('all'));
    await user.selectOptions(select, 'off');
    await waitFor(async () =>
      expect((await sourcesRepo.get('a'))?.prefs).toEqual({ liveFormat: 'auto' }),
    );
  });

  it('a failed routing save puts the select back and says so', async () => {
    await sourcesRepo.put(list('a'));
    await savePersonalProxy({ baseUrl: PROXY, token: TOKEN });
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    const select = await screen.findByLabelText(text.routing.label('List a'));
    vi.spyOn(sourcesRepo, 'update').mockRejectedValueOnce(new Error('quota'));
    await user.selectOptions(select, 'all');
    await waitFor(() =>
      expect(screen.getByTestId('toast-assertive')).toHaveTextContent(text.routing.saveError),
    );
    expect(select).toHaveValue('off');
  });

  it('test: ok without lists (active streams shown), using the saved token', async () => {
    await savePersonalProxy({ baseUrl: PROXY, token: TOKEN });
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    await urlField();
    await user.click(screen.getByRole('button', { name: text.test }));
    await waitFor(() => expect(status()).toHaveTextContent(text.outcomes.ok('3')));
    expect(requests).toEqual([`${PROXY}/v1/${TOKEN}/health`]);
  });

  it('test: probes the active list’s server origin; allowed / not allowed', async () => {
    await sourcesRepo.put(list('a'));
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    await fill(user, PROXY, TOKEN);
    await user.click(screen.getByRole('button', { name: text.test }));
    await waitFor(() => expect(status()).toHaveTextContent(text.outcomes.okList('List a', '3')));
    const probe = requests[0]?.split('/').pop() ?? '';
    expect(Buffer.from(probe, 'base64url').toString('utf8')).toBe(`${PANEL}/`);

    await sourcesRepo.update('a', { serverUrl: 'http://other.example.test' });
    await user.click(screen.getByRole('button', { name: text.test }));
    await waitFor(() => expect(status()).toHaveTextContent(text.outcomes.notAllowed('List a')));
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
  });

  it.each([
    ['wrong token (401)', () => new HttpResponse(null, { status: 401 }), text.outcomes.auth],
    ['not a proxy (404)', () => new HttpResponse('nope', { status: 404 }), text.outcomes.notProxy],
    ['unexpected JSON', () => HttpResponse.json({ hello: 'world' }), text.outcomes.notProxy],
    ['HTML page', () => HttpResponse.html('<!doctype html><p>hi</p>'), text.outcomes.notProxy],
    [
      'gateway error (502)',
      () => new HttpResponse(null, { status: 502 }),
      text.outcomes.unreachable,
    ],
    ['network failure', () => HttpResponse.error(), text.outcomes.unreachable],
  ])('test outcome: %s', async (_name, respond, message) => {
    server.use(http.get(`${PROXY}/v1/:token/health`, respond));
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    await fill(user, PROXY, TOKEN);
    await user.click(screen.getByRole('button', { name: text.test }));
    await waitFor(() => expect(status()).toHaveTextContent(message));
    expect(within(status()).getByRole('alert')).toBeInTheDocument();
  });

  it('remove: clears the address, the token and every list’s routing', async () => {
    await sourcesRepo.put(list('a', { prefs: { liveFormat: 'auto', proxy: 'all' } }));
    await savePersonalProxy({ baseUrl: PROXY, token: TOKEN });
    const user = userEvent.setup();
    renderSettings(<ProxySection />);
    expect(await urlField()).toHaveValue(PROXY);
    expect(screen.getByLabelText(text.routing.label('List a'))).toHaveValue('all');
    await user.click(screen.getByRole('button', { name: text.remove }));
    await waitFor(() => expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.removed));
    expect(await settingsRepo.get('personalProxy')).toBeUndefined();
    expect(await credentialVault.get(PROXY_TOKEN_REF)).toBeUndefined();
    expect((await sourcesRepo.get('a'))?.prefs).toEqual({ liveFormat: 'auto' });
    expect(await urlField()).toHaveValue('');
    const select = screen.getByLabelText(text.routing.label('List a'));
    expect(select).toHaveValue('off');
    expect(select).toBeDisabled();
  });
});
