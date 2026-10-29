// SRC-09: the diagnostics screen — checklist, explanations with actions, "Copy report" (masked),
// and the active-list entry point used by the player.
import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourcesRepo, wipeAll } from '@/core/db';
import { NetError } from '@/core/net';
import type { Capabilities } from '@/core/platform';
import { t } from '@/i18n';
import type { XtreamConnectionReport } from '@/providers/xtream';
import { forgetActiveSource } from '../activeSource';
import { sourcesRoutes } from '../routes';
import { makeSource, renderRoutes, seedSource, setStoredActive } from '../test-utils';
import { CODECS } from './codecs';
import { ActiveSourceDiagnosticsScreen, DiagnosticsScreen } from './DiagnosticsScreen';
import type { DiagnosticsDeps } from './runDiagnostics';

// Fictitious values only (CLAUDE.md).
const HOST = 'panel.example.test';
const USER = 'jdoe';
const PASS = 'testpass';

let media: { restore(): void } | undefined;
afterEach(async () => {
  media?.restore();
  media = undefined;
  vi.restoreAllMocks();
  forgetActiveSource();
  await wipeAll();
});

const caps: Capabilities = {
  mse: true,
  mms: false,
  nativeHls: false,
  isSafari: false,
  isIOS: false,
  pip: true,
  fullscreenApi: true,
  canPlay: () => true,
};

const xtream = makeSource({
  id: 'tv',
  kind: 'xtream',
  name: HOST,
  serverUrl: `http://${HOST}:8080`,
  username: USER,
  secretRef: 'source:tv:password',
});

function deps(report: Partial<XtreamConnectionReport> = {}): Partial<DiagnosticsDeps> {
  return {
    readPassword: () => Promise.resolve(PASS),
    testXtream: () =>
      Promise.resolve({
        ok: false,
        https: false,
        corsApi: 'blocked',
        baseUrl: `http://${HOST}:8080`,
        problems: [],
        error: new NetError({ kind: 'blocked', hint: 'mixed-content' }),
        ...report,
      }),
    capabilities: () => caps,
    codecs: () => CODECS.map((codec) => ({ codec, mediaSource: codec !== 'ac3', native: false })),
    pageProtocol: () => 'https:',
    offline: () => false,
    now: () => Date.UTC(2026, 9, 29),
  };
}

async function show(
  props: { deps?: Partial<DiagnosticsDeps>; writeClipboard?: (text: string) => Promise<void> } = {},
  path = '/settings/sources/tv/diagnostics',
) {
  const view = renderRoutes(
    [
      {
        path: '/settings/sources/:sourceId/diagnostics',
        element: (
          <DiagnosticsScreen deps={props.deps ?? deps()} writeClipboard={props.writeClipboard} />
        ),
      },
      { path: '/settings/sources/diagnostics', element: <ActiveSourceDiagnosticsScreen /> },
    ],
    path,
  );
  media = view.media;
  return view;
}

describe('DiagnosticsScreen', () => {
  it('shows the five checks with status, explanation and actions (AC1/AC2)', async () => {
    await seedSource(xtream, PASS);
    await show();
    const text = t.diagnostics;

    const https = await screen.findByTestId('check-https');
    expect(https).toHaveAttribute('data-status', 'error');
    expect(within(https).getByText(text.checks.https.reasons['http-blocked'])).toBeInTheDocument();
    expect(within(https).getByText(text.actions['use-https'])).toBeInTheDocument();
    expect(within(https).getByText(text.actions['proxy-future'])).toBeInTheDocument();
    // "Use HTTPS" leads to editing the list; "local file" to adding a list.
    expect(within(https).getByRole('link', { name: text.links.editList })).toHaveAttribute(
      'href',
      '/settings/sources/tv/edit',
    );
    expect(within(https).getByRole('link', { name: text.links.addList })).toHaveAttribute(
      'href',
      '/settings/sources',
    );

    expect(screen.getByTestId('check-api')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('check-liveFormat')).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('check-browser')).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('check-codecs')).toHaveAttribute('data-status', 'warning');
    expect(screen.getByText(text.summary.error)).toBeInTheDocument();
  });

  it('"switch live format" changes THIS list (not the active one) and checks again', async () => {
    await seedSource({ ...xtream, prefs: { liveFormat: 'ts' } }, PASS);
    await seedSource(makeSource({ id: 'other', kind: 'xtream', name: 'Other' }));
    await setStoredActive('other');
    const { user } = await show({
      deps: deps({
        ok: true,
        corsApi: 'ok',
        error: undefined,
        account: { status: 'Active', formats: ['m3u8'] },
      }),
    });
    const live = await screen.findByTestId('check-liveFormat');
    expect(live).toHaveAttribute('data-status', 'warning');
    expect(within(live).queryByRole('link', { name: /settings/i })).toBeNull();

    await user.click(
      within(live).getByRole('button', {
        name: t.diagnostics.links.useFormat(t.diagnostics.checks.liveFormat.formats.m3u8),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('check-liveFormat')).toHaveAttribute('data-status', 'ok'),
    );
    expect((await sourcesRepo.get('tv'))?.prefs.liveFormat).toBe('m3u8');
    expect((await sourcesRepo.get('other'))?.prefs.liveFormat).toBe('auto');
  });

  it('"Copy report" copies a report without credentials or host (AC3)', async () => {
    await seedSource(xtream, PASS);
    const writeClipboard = vi.fn((_text: string) => Promise.resolve());
    const { user } = await show({ writeClipboard });
    await user.click(await screen.findByRole('button', { name: t.diagnostics.copy }));

    expect(writeClipboard).toHaveBeenCalledTimes(1);
    const report = writeClipboard.mock.calls[0]![0];
    expect(report).toContain(t.diagnostics.report.heading);
    for (const secret of [HOST, USER, PASS, '8080']) expect(report).not.toContain(secret);
    expect(await screen.findByText(t.diagnostics.copied)).toBeInTheDocument();
  });

  it('without a clipboard, shows the report to copy by hand', async () => {
    await seedSource(xtream, PASS);
    const { user } = await show({
      writeClipboard: () => Promise.reject(new Error('denied')),
    });
    await user.click(await screen.findByRole('button', { name: t.diagnostics.copy }));
    const box = await screen.findByRole('textbox', { name: t.diagnostics.copyFailed });
    expect((box as HTMLTextAreaElement).value).toContain(t.diagnostics.report.heading);
    expect((box as HTMLTextAreaElement).value).not.toContain(HOST);
  });

  it('"Check again" runs the checks again', async () => {
    await seedSource(xtream, PASS);
    const testXtream = vi.fn(deps().testXtream!);
    const { user } = await show({ deps: { ...deps(), testXtream } });
    await user.click(await screen.findByRole('button', { name: t.diagnostics.runAgain }));
    await screen.findByTestId('check-api');
    expect(testXtream).toHaveBeenCalledTimes(2);
  });

  it('a removed list → not found', async () => {
    await show();
    expect(await screen.findByText(t.diagnostics.notFound.title)).toBeInTheDocument();
  });

  it('the active-list entry point opens the active list’s diagnostics', async () => {
    await seedSource(xtream, PASS);
    await seedSource(makeSource({ id: 'file', kind: 'm3u-file', name: 'Laptop list' }));
    await setStoredActive('file');
    const { router } = await show({}, '/settings/sources/diagnostics');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/sources/file/diagnostics'),
    );
    // A local file: network checks are skipped.
    expect(await screen.findByTestId('check-api')).toHaveAttribute('data-status', 'skipped');
  });

  it('is registered in the feature routes', () => {
    const paths = sourcesRoutes.map((r) => r.path);
    expect(paths).toContain('settings/sources/:sourceId/diagnostics');
    expect(paths).toContain('settings/sources/diagnostics');
  });
});
