// Live player area (LIV-02): resolves the selected channel's stream (latest wins), hands it to
// the lazily loaded PlayerView and records the channel in "Recent" after 5 s of playback.
//
// Zapping (docs/UX_UI.md §6.2): the new channel's name is shown at once; a zapped channel is
// resolved after ZAP_SETTLE_MS without another change, and a resolution that finishes after a
// newer selection is dropped. Meanwhile the previous stream keeps the <video> (the PlayerView
// stays mounted), and its controller aborts it when the next descriptor arrives.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { historyRepo, type Channel, type Source } from '@/core/db';
import { log } from '@/core/log';
import type { PlaybackError, PlayerController, StreamDescriptor } from '@/player';
import type { ControllerFactory } from '@/player/ui';
import { t } from '@/i18n';
import { StateView, errorDetails } from '@/ui/state';
import { resolveStream, type ResolvedStream } from './resolveStream';
import { useWatchTimer } from './useWatchTimer';
import { ZAP_SETTLE_MS } from './zapping';

/** How a channel was selected: a zap is debounced, a pick or a restore starts at once. */
export type SelectionVia = 'pick' | 'zap' | 'restore';

export interface LiveSelection {
  channel: Channel;
  via: SelectionVia;
}

// The player UI and the controller are loaded on demand (PLY-02 lazy boundary): neither is in
// the Live chunk. The controller factory is kept here so LivePlayer can listen to its errors.
let createController: ((video: HTMLVideoElement) => PlayerController) | undefined;
const PlayerView = lazy(async () => {
  const [ui, player] = await Promise.all([import('@/player/ui'), import('@/player')]);
  createController = (video) => player.createPlayerController(video);
  return { default: ui.PlayerView };
});

type Outcome = ResolvedStream | { status: 'error'; error: unknown };

interface Shown {
  key: string;
  descriptor: StreamDescriptor;
  requiredHeaders: boolean;
}

export interface LivePlayerProps {
  source: Source;
  selection: LiveSelection;
  onPrevious: () => void;
  onNext: () => void;
  onToggleChannelList: () => void;
  onClose: () => void;
  /** Rendered over the video (the "Channels" panel). */
  overlay?: ReactNode;
}

export function LivePlayer({
  source,
  selection,
  onPrevious,
  onNext,
  onToggleChannelList,
  onClose,
  overlay,
}: LivePlayerProps) {
  const { channel } = selection;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ selection: LiveSelection; outcome: Outcome }>();
  const [shown, setShown] = useState<Shown>();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [playbackError, setPlaybackError] = useState<{ key: string; error: PlaybackError }>();

  // Resolve the selected channel: debounced for zaps, latest wins.
  useEffect(() => {
    let current = true;
    const run = () => {
      resolveStream(selection.channel, source).then(
        (outcome) => {
          if (!current) return;
          setResult({ selection, outcome });
          setShown(
            outcome.status === 'ok'
              ? {
                  key: selection.channel.key,
                  descriptor: outcome.descriptor,
                  requiredHeaders: outcome.requiredHeaders,
                }
              : undefined,
          );
        },
        (error: unknown) => {
          if (!current) return;
          log.warn('live: resolving the stream failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
          setResult({ selection, outcome: { status: 'error', error } });
          setShown(undefined);
        },
      );
    };
    const timer = selection.via === 'zap' ? setTimeout(run, ZAP_SETTLE_MS) : undefined;
    if (timer === undefined) run();
    return () => {
      current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [selection, source, attempt]);

  const outcome = result?.selection === selection ? result.outcome : undefined;
  const playingThis = shown?.key === channel.key;

  // Counted only once this channel's own stream is in the player.
  const record = useCallback((itemKey: string) => {
    historyRepo.upsert({ itemKey }).catch((error: unknown) => {
      log.warn('live: recording the recent channel failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
  }, []);
  useWatchTimer(container, playingThis ? channel.key : undefined, record);

  // Playback errors, read from the controller (PlayerView has no error callback).
  // TODO(PLY-04): fold the "restricted" message into the player's own error overlay.
  const onPlaybackError = useCallback((key: string, error: PlaybackError) => {
    setPlaybackError({ key, error });
  }, []);
  const shownKey = shown?.key;
  // Key of the stream in the player, read by the controller's error listener (created once per
  // <video>, so it cannot close over render state).
  const shownKeyRef = useRef(shownKey);
  useEffect(() => {
    shownKeyRef.current = shownKey;
  }, [shownKey]);
  const factory = useCallback<ControllerFactory>(
    (video) => {
      if (!createController) throw new Error('player controller not loaded');
      const controller = createController(video);
      controller.on('error', (error) => {
        const key = shownKeyRef.current;
        if (key !== undefined) onPlaybackError(key, error);
      });
      return controller;
    },
    [onPlaybackError],
  );
  const failure = playbackError && playbackError.key === shownKey ? playbackError.error : undefined;
  const restricted =
    shown?.requiredHeaders === true &&
    failure !== undefined &&
    (failure.kind === 'auth' || failure.status === 401 || failure.status === 403);

  let body: ReactNode;
  if (outcome && outcome.status !== 'ok') {
    body = <ResolveProblem outcome={outcome} onRetry={() => setAttempt((n) => n + 1)} />;
  } else if (shown) {
    body = (
      <Suspense fallback={<Pending name={channel.name} />}>
        <PlayerView
          descriptor={shown.descriptor}
          title={channel.name}
          kind="live"
          onPrevious={onPrevious}
          onNext={onNext}
          onToggleChannelList={onToggleChannelList}
          onClose={onClose}
          createController={factory}
        />
      </Suspense>
    );
  } else {
    body = <Pending name={channel.name} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        ref={setContainer}
        data-testid="live-player"
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          bgcolor: 'common.black',
          color: 'common.white',
          borderRadius: { xs: 2, sm: 3 },
          overflow: 'hidden',
        }}
      >
        {body}
        {shown && !playingThis && (!outcome || outcome.status === 'ok') && (
          // On-screen display while the zapped channel is pending: its name, immediately.
          <Box
            data-testid="zap-osd"
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              px: 1.5,
              py: 0.5,
              borderRadius: 2,
              bgcolor: (theme) => alpha(theme.palette.common.black, 0.72),
              color: 'common.white',
              typography: 'subtitle1',
              pointerEvents: 'none',
            }}
          >
            {channel.number !== undefined ? `${channel.number} · ${channel.name}` : channel.name}
          </Box>
        )}
        {overlay}
      </Box>
      {restricted && (
        <Alert severity="warning" role="alert">
          {t.live.player.restricted}
        </Alert>
      )}
    </Box>
  );
}

function Pending({ name }: { name: string }) {
  return (
    <Box
      data-testid="player-pending"
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        p: 2,
        textAlign: 'center',
      }}
    >
      <CircularProgress aria-hidden size={48} sx={{ color: 'common.white' }} />
      <Typography variant="subtitle1">{t.live.player.loading(name)}</Typography>
    </Box>
  );
}

function ResolveProblem({
  outcome,
  onRetry,
}: {
  outcome: Exclude<Outcome, { status: 'ok' }>;
  onRetry: () => void;
}) {
  const texts = t.live.player;
  let view: ReactNode;
  switch (outcome.status) {
    case 'unsupported':
      view = (
        <StateView
          variant="error"
          title={texts.unsupported.title}
          message={texts.unsupported.message}
        />
      );
      break;
    case 'credentials':
      view = (
        <StateView
          variant="error"
          title={texts.credentials.title}
          message={texts.credentials.message}
          actions={
            <Button variant="contained" component={Link} to="/settings/sources">
              {texts.credentials.action}
            </Button>
          }
        />
      );
      break;
    case 'unavailable':
      view = (
        <StateView
          variant="error"
          title={texts.unavailable.title}
          message={texts.unavailable.message}
        />
      );
      break;
    case 'error':
      view = (
        <StateView
          variant="error"
          title={texts.resolveError.title}
          message={texts.resolveError.message}
          details={errorDetails(outcome.error)}
          actions={
            <Button variant="contained" onClick={onRetry}>
              {t.state.actions.retry}
            </Button>
          }
        />
      );
      break;
  }
  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      {view}
    </Box>
  );
}
