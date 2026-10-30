// Player error overlay (PLY-04, PLY-06): the localized error with its actions, the technical
// details of every format tried, and — after the failure, once per failed load — a check of the
// addresses that tried to explain why (mixed content, redirects, CORS, HEVC). The check is
// loaded on demand (`@/player/probe`) and never changes playback: it only explains it.
//
// Layout (PLY-06 AC D): the overlay starts below the player's top bar and scrolls; its content is
// centred with `margin: auto` rather than `align-items: center`, so a message taller than the
// player (a phone in portrait) starts at the top of the scroll area instead of being pushed
// above it, where it could not be scrolled to.
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { StateView } from '@/ui/state';
import { errorName } from '../errors';
import type { AttemptProbe, ProbeSummary } from '../probe';
import type { PlaybackError, StreamDescriptor } from '../types';
import type { PlaybackErrorText } from './describePlaybackError';
import { failureDetails, type AttemptCheck } from './failureDetails';

/** Height reserved for the player's top bar (back · title · live), which stays visible. */
export const ERROR_OVERLAY_TOP_PX = 64;

/** Runs the root-cause probe of a failed load (tests inject a fake). */
export type FailureProbe = (
  descriptor: StreamDescriptor,
  error: PlaybackError,
  signal: AbortSignal,
) => Promise<{ probes: AttemptProbe[]; summary: ProbeSummary | undefined }>;

export const defaultFailureProbe: FailureProbe = async (descriptor, error, signal) => {
  const probe = await import('../probe');
  const probes = await probe.probeAttempts(descriptor, error.attempts ?? [], { signal });
  return {
    probes,
    summary: probe.summarizeFindings(
      probes.map((p) => ({ finding: p.finding, hevc: p.result.hevc })),
    ),
  };
};

/** A probe is worth running when an address was actually requested and the device is online. */
export function shouldProbe(error: PlaybackError, offline: boolean): boolean {
  if (offline || error.kind === 'unsupported-codec') return false;
  return (error.attempts ?? []).some((attempt) => attempt.engine !== 'unsupported');
}

interface ProbeState {
  error: PlaybackError;
  probes: AttemptProbe[];
  summary: ProbeSummary | undefined;
}

export interface PlaybackErrorOverlayProps {
  error: PlaybackError;
  text: PlaybackErrorText;
  /** The descriptor that failed (its addresses are probed in memory; never shown). */
  descriptor: StreamDescriptor;
  /** The failure happened offline: no probe. */
  offline: boolean;
  onRetry: () => void;
  /** Live: "Next channel". */
  onNext?: (() => void) | undefined;
  /** Where "Connection diagnostics" leads. */
  diagnosticsPath: string;
  /** Tests: fake probe. */
  probe?: FailureProbe;
  /** PLY-08: "Open in VLC" (the stream may play there); omitted when the setting hides it. */
  onOpenInVlc?: (() => void) | undefined;
  /** Tests: clipboard. Default `navigator.clipboard.writeText`. */
  writeClipboard?: (text: string) => Promise<void>;
}

const defaultWriteClipboard = (text: string): Promise<void> => {
  const clipboard = (globalThis as { navigator?: { clipboard?: Clipboard } }).navigator?.clipboard;
  if (!clipboard) return Promise.reject(new Error('Clipboard unavailable'));
  return clipboard.writeText(text);
};

export function PlaybackErrorOverlay({
  error,
  text,
  descriptor,
  offline,
  onRetry,
  onNext,
  diagnosticsPath,
  onOpenInVlc,
  probe = defaultFailureProbe,
  writeClipboard = defaultWriteClipboard,
}: PlaybackErrorOverlayProps) {
  const [probeState, setProbeState] = useState<ProbeState>();
  const [copied, setCopied] = useState<{ error: PlaybackError; ok: boolean }>();
  const wanted = shouldProbe(error, offline);

  // Once per failure: a retry that fails again is a new PlaybackError, so a new check.
  useEffect(() => {
    if (!wanted) return undefined;
    const controller = new AbortController();
    probe(descriptor, error, controller.signal).then(
      ({ probes, summary }) => {
        if (controller.signal.aborted) return;
        log.info('player: failure probe', {
          findings: probes.map((p) => `${p.index}:${p.finding}`),
        });
        setProbeState({ error, probes, summary });
      },
      (e: unknown) => {
        if (controller.signal.aborted) return;
        log.warn('player: failure probe failed', { error: errorName(e) });
        setProbeState({ error, probes: [], summary: undefined });
      },
    );
    return () => controller.abort();
  }, [wanted, error, descriptor, probe]);

  const done = probeState?.error === error ? probeState : undefined;
  const running = wanted && done === undefined;
  const checks: AttemptCheck[] =
    done?.probes.map((p) => ({
      index: p.index,
      finding: p.finding,
      status: p.result.status,
      redirected: p.result.redirected,
      hevc: p.result.hevc,
    })) ?? [];
  const details = failureDetails(error, checks);
  const summary = done?.summary;
  const showDiagnostics =
    text.action === 'diagnostics' || (summary !== undefined && summary.finding !== 'ok');
  const copyState = copied?.error === error ? copied : undefined;

  const copy = () => {
    writeClipboard(details).then(
      () => setCopied({ error, ok: true }),
      (e: unknown) => {
        log.info('player: clipboard unavailable', { error: errorName(e) });
        setCopied({ error, ok: false });
      },
    );
  };

  return (
    <Box
      data-testid="player-error"
      sx={{
        position: 'absolute',
        inset: 0,
        top: ERROR_OVERLAY_TOP_PX,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        // Opaque theme surface: the StateView texts use the theme's text colors.
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <Box data-testid="player-error-content" sx={{ m: 'auto', width: '100%', minWidth: 0 }}>
        <StateView
          variant="error"
          title={text.title}
          message={text.message}
          details={details}
          actions={
            <>
              <Button variant="contained" onClick={onRetry}>
                {t.state.actions.retry}
              </Button>
              {onNext && (
                <Button variant="outlined" onClick={onNext}>
                  {t.player.controls.nextChannel}
                </Button>
              )}
              {onOpenInVlc && (
                <Button variant="outlined" onClick={onOpenInVlc}>
                  {t.player.external.openInVlc}
                </Button>
              )}
              {showDiagnostics && (
                <Button variant="text" component={Link} to={diagnosticsPath}>
                  {t.player.errors.actions.diagnostics}
                </Button>
              )}
              <Button variant="text" onClick={copy}>
                {t.player.attempts.copy}
              </Button>
            </>
          }
        />
        {(running || done !== undefined || copyState !== undefined) && (
          <Box sx={{ maxWidth: 560, mx: 'auto', px: 2, pb: 4, display: 'grid', gap: 1 }}>
            {copyState !== undefined && (
              <Typography role="status" variant="body2" color="text.secondary">
                {copyState.ok ? t.player.attempts.copied : t.player.attempts.copyFailed}
              </Typography>
            )}
            {running && (
              <Typography role="status" variant="body2" color="text.secondary">
                {t.player.probe.checking}
              </Typography>
            )}
            {summary !== undefined && (
              <Alert severity="info" role="status" data-testid="player-error-cause">
                <AlertTitle>{t.player.probe.title}</AlertTitle>
                {t.player.probe.causes[summary.finding]}
                {summary.hevc && (
                  <Box component="span" sx={{ display: 'block', mt: 1 }}>
                    {t.player.probe.hevc}
                  </Box>
                )}
              </Alert>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
