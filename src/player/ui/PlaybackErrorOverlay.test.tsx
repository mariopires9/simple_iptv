// PLY-06: the error overlay lists every attempt (A), shows the root-cause check (B) and keeps
// the whole message reachable on a phone (D). Credentials and the host never appear.
import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { t } from '@/i18n';
import { createAppTheme } from '@/ui';
import type { AttemptProbe, ProbeSummary } from '../probe';
import { PlaybackError, withAttempts, type StreamDescriptor } from '../types';
import { describePlaybackError } from './describePlaybackError';
import { failureDetails } from './failureDetails';
import {
  ERROR_OVERLAY_TOP_PX,
  PlaybackErrorOverlay,
  shouldProbe,
  type FailureProbe,
} from './PlaybackErrorOverlay';
import { LIVE, flush, renderPlayer } from './test-utils/renderPlayer';

// Fictitious values only (CLAUDE.md).
const HOST = 'panel.example.test';
const PREFIX = `https://${HOST}/live/jdoe/s3cretpw/42`;
const DESCRIPTOR: StreamDescriptor = {
  url: `${PREFIX}.ts`,
  kind: 'live',
  container: 'ts',
  fallbacks: [{ url: `${PREFIX}.m3u8`, kind: 'live', container: 'hls' }],
};

/** The iPhone report: TS via mpegts.js (ManagedMediaSource) blocked, then native HLS refused. */
function iphoneError(): PlaybackError {
  const ts = new PlaybackError({
    kind: 'blocked',
    engine: 'mpegts',
    detail: 'Exception',
    hint: 'cors',
    url: `${PREFIX}.ts`,
  });
  const hls = new PlaybackError({
    kind: 'unsupported-container',
    engine: 'native',
    detail: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    url: `${PREFIX}.m3u8`,
  });
  return withAttempts(hls, [
    { engine: 'mpegts', container: 'ts', mediaSource: 'mms', error: ts },
    { engine: 'native', container: 'hls', error: hls },
  ]);
}

const theme = createAppTheme('dark');

function renderOverlay(
  error: PlaybackError,
  props: {
    probe?: FailureProbe;
    offline?: boolean;
    writeClipboard?: (s: string) => Promise<void>;
  } = {},
) {
  const onRetry = vi.fn();
  const view = render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <div style={{ position: 'relative', width: 390, height: 219 }}>
          <PlaybackErrorOverlay
            error={error}
            text={describePlaybackError(error, { kind: 'live' })}
            descriptor={DESCRIPTOR}
            offline={props.offline ?? false}
            onRetry={onRetry}
            onNext={vi.fn()}
            diagnosticsPath="/settings/sources/diagnostics"
            probe={props.probe ?? (() => new Promise(() => {}))}
            {...(props.writeClipboard ? { writeClipboard: props.writeClipboard } : {})}
          />
        </div>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return { onRetry, unmount: view.unmount };
}

const summaryOf = (finding: ProbeSummary['finding'], hevc = false): ProbeSummary => ({
  finding,
  hevc,
  mixedContent: finding.startsWith('insecure') || finding === 'redirect-blocked',
});

const probesOf = (...findings: AttemptProbe['finding'][]): AttemptProbe[] =>
  findings.map((finding, index) => ({
    index,
    finding,
    result: { cause: finding === 'no-cors-native' ? 'no-cors' : finding, target: 'https://***/x' },
  })) as AttemptProbe[];

function expectMasked(text: string) {
  expect(text).not.toContain(HOST);
  expect(text).not.toContain('jdoe');
  expect(text).not.toContain('s3cretpw');
}

afterEach(() => clearLogBuffer());

describe('failureDetails (A)', () => {
  it('lists every attempt in order with format, engine and Media Source API, masked', () => {
    const text = failureDetails(iphoneError());
    const lines = text.split('\n');
    expect(lines).toContain('Attempts:');
    expect(text).toContain(
      '1. MPEG-TS via mpegts.js (ManagedMediaSource): Stream blocked by the browser (blocked, mpegts, Exception, cors): https://***/live/***/***/***.ts',
    );
    expect(text).toContain(
      '2. HLS via native player: Stream format not supported (unsupported-container, native, MEDIA_ERR_SRC_NOT_SUPPORTED): https://***/live/***/***/***.m3u8',
    );
    expect(text.indexOf('1. MPEG-TS')).toBeLessThan(text.indexOf('2. HLS'));
    expectMasked(text);
  });

  it('adds what the check found under each attempt', () => {
    const text = failureDetails(iphoneError(), [
      { index: 0, finding: 'no-cors' },
      { index: 1, finding: 'redirect-blocked', redirected: true },
    ]);
    expect(text).toContain('   Check: no-cors');
    expect(text).toContain('   Check: redirect-blocked (redirected)');
  });

  it('a skipped candidate says so', () => {
    const skipped = new PlaybackError({ kind: 'unsupported-container', detail: 'container:ts' });
    const error = withAttempts(skipped, [
      { engine: 'unsupported', container: 'ts', error: skipped },
    ]);
    expect(failureDetails(error)).toContain(
      '1. MPEG-TS via not playable in this browser (skipped)',
    );
  });

  it('without attempts it is the error message', () => {
    const error = new PlaybackError({ kind: 'network', url: `${PREFIX}.ts` });
    expect(failureDetails(error)).toBe(error.message);
  });
});

describe('PlaybackErrorOverlay', () => {
  it('shows every attempt in Details (A)', () => {
    renderOverlay(iphoneError());
    const details = screen.getByText(/Attempts:/);
    expect(details).toHaveTextContent('1. MPEG-TS via mpegts.js (ManagedMediaSource)');
    expect(details).toHaveTextContent('2. HLS via native player');
    expectMasked(document.body.textContent ?? '');
  });

  it('"Copy details" copies the masked text', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    renderOverlay(iphoneError(), { writeClipboard });
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(screen.getByText('Details copied')).toBeInTheDocument());
    const copied = (writeClipboard.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain('2. HLS via native player');
    expectMasked(copied);
  });

  it('a clipboard failure says how to copy by hand', async () => {
    renderOverlay(iphoneError(), { writeClipboard: () => Promise.reject(new Error('denied')) });
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(await screen.findByText(t.player.attempts.copyFailed)).toBeInTheDocument();
  });

  it('runs the check once, shows "Checking…", then the likely cause and the diagnostics link (B)', async () => {
    let resolve: (v: Awaited<ReturnType<FailureProbe>>) => void = () => {};
    const probe = vi.fn<FailureProbe>(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const error = iphoneError();
    renderOverlay(error, { probe });
    expect(screen.getByText('Checking the cause…')).toBeInTheDocument();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0]?.[0]).toBe(DESCRIPTOR);
    await act(async () => {
      resolve({
        probes: probesOf('no-cors', 'redirect-blocked'),
        summary: summaryOf('redirect-blocked'),
      });
      await Promise.resolve();
    });
    const cause = screen.getByTestId('player-error-cause');
    expect(cause).toHaveTextContent('Likely cause');
    expect(cause).toHaveTextContent(t.player.probe.causes['redirect-blocked']);
    expect(screen.queryByText('Checking the cause…')).toBeNull();
    expect(screen.getByRole('link', { name: 'Connection diagnostics' })).toHaveAttribute(
      'href',
      '/settings/sources/diagnostics',
    );
    expect(screen.getByText(/Attempts:/)).toHaveTextContent('Check: redirect-blocked');
    expect(probe).toHaveBeenCalledTimes(1);
    expectMasked(JSON.stringify(getLogEntries()));
  });

  it('the insecure redirect message is specific', async () => {
    renderOverlay(iphoneError(), {
      probe: () =>
        Promise.resolve({
          probes: probesOf('no-cors', 'insecure-redirect'),
          summary: summaryOf('insecure-redirect'),
        }),
    });
    expect(await screen.findByTestId('player-error-cause')).toHaveTextContent(
      'The server redirects the stream to an insecure http:// address, which the browser blocks inside an https app',
    );
  });

  it('adds the HEVC hint', async () => {
    renderOverlay(iphoneError(), {
      probe: () =>
        Promise.resolve({ probes: probesOf('ok', 'ok'), summary: summaryOf('ok', true) }),
    });
    expect(await screen.findByTestId('player-error-cause')).toHaveTextContent(t.player.probe.hevc);
  });

  it('no check offline, for a known codec, or when nothing was requested', () => {
    const probe = vi.fn<FailureProbe>();
    renderOverlay(iphoneError(), { probe, offline: true });
    expect(probe).not.toHaveBeenCalled();
    expect(shouldProbe(iphoneError(), true)).toBe(false);
    expect(shouldProbe(new PlaybackError({ kind: 'blocked' }), false)).toBe(false);
    const codec = new PlaybackError({ kind: 'unsupported-codec' });
    expect(
      shouldProbe(withAttempts(codec, [{ engine: 'hls', container: 'hls', error: codec }]), false),
    ).toBe(false);
    expect(shouldProbe(iphoneError(), false)).toBe(true);
  });

  it('leaving the overlay aborts a running check (no leak)', () => {
    let signal: AbortSignal | undefined;
    const view = renderOverlay(iphoneError(), {
      probe: (_d, _e, s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('a failing check leaves the overlay as it was', async () => {
    renderOverlay(iphoneError(), { probe: () => Promise.reject(new Error('boom')) });
    await waitFor(() => expect(screen.queryByText('Checking the cause…')).toBeNull());
    expect(screen.queryByTestId('player-error-cause')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('layout (D): below the top bar, scrollable, content centred with margin auto', () => {
    renderOverlay(iphoneError());
    const overlay = screen.getByTestId('player-error');
    const style = getComputedStyle(overlay);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(`${ERROR_OVERLAY_TOP_PX}px`);
    expect(style.overflowY).toBe('auto');
    // align-items: center would push the start of a tall message above the scroll area.
    expect(style.alignItems).not.toBe('center');
    const content = within(overlay).getByTestId('player-error-content');
    expect(getComputedStyle(content).margin).toBe('auto');
    // The title is inside the scroll container, so it can always be scrolled into view.
    expect(
      within(content).getByRole('heading', {
        name: t.player.errors['unsupported-container'].title,
      }),
    ).toBeInTheDocument();
  });
});

describe('PlayerView wiring', () => {
  it('a final error with attempts shows them and runs the injected probe once', async () => {
    const failureProbe = vi.fn<FailureProbe>(() =>
      Promise.resolve({ probes: probesOf('no-cors'), summary: summaryOf('no-cors') }),
    );
    const error = iphoneError();
    const view = renderPlayer({ descriptor: LIVE, failureProbe }, { router: true });
    await flush();
    act(() => view.controller.emit('error', error));
    await flush();
    expect(screen.getByText(/Attempts:/)).toHaveTextContent('1. MPEG-TS via mpegts.js');
    expect(screen.getByTestId('player-error-cause')).toHaveTextContent(
      t.player.probe.causes['no-cors'],
    );
    expect(failureProbe).toHaveBeenCalledTimes(1);
    expect(failureProbe.mock.calls[0]?.[0]).toEqual(LIVE);
  });
});
