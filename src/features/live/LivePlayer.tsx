// Live player area (LIV-02): resolves the selected channel's stream (latest wins), hands it to
// the lazily loaded PlayerView and records the channel in "Recent" after 5 s of playback.
//
// Zapping (docs/UX_UI.md §6.2): the new channel's name is shown at once; a zapped channel is
// resolved after ZAP_SETTLE_MS without another change, and a resolution that finishes after a
// newer selection is dropped. Meanwhile the previous stream keeps the <video> (the PlayerView
// stays mounted), and its controller aborts it when the next descriptor arrives.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Link } from 'react-router';
import { historyRepo, type Channel, type Source } from '@/core/db';
import { log } from '@/core/log';
import type { PlaybackError, StreamDescriptor } from '@/player';
import { t } from '@/i18n';
import { StateView, errorDetails } from '@/ui/state';
import { CHANNELS_PANEL_ATTRIBUTE } from './ChannelsOverlay';
import { resolveStream, type ResolvedStream } from './resolveStream';
import { useWatchTimer } from './useWatchTimer';
import { ZAP_SETTLE_MS } from './zapping';

/** How a channel was selected: a zap is debounced, a pick or a restore starts at once. */
export type SelectionVia = 'pick' | 'zap' | 'restore';

export interface LiveSelection {
  channel: Channel;
  via: SelectionVia;
}

// The player UI (with its controller) is loaded on demand (PLY-02 lazy boundary): it is not in
// the Live chunk.
const PlayerView = lazy(async () => ({ default: (await import('@/player/ui')).PlayerView }));

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
  /** Imperative handle: `focus()` returns focus to the player (after the panel closes). */
  handleRef?: Ref<LivePlayerHandle>;
}

export interface LivePlayerHandle {
  /** Focuses what last had focus in the player (its region, so the shortcuts work again). */
  focus(): void;
}

export function LivePlayer({
  source,
  selection,
  onPrevious,
  onNext,
  onToggleChannelList,
  onClose,
  overlay,
  handleRef,
}: LivePlayerProps) {
  const { channel } = selection;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    selection: LiveSelection;
    attempt: number;
    outcome: Outcome;
  }>();
  const [shown, setShown] = useState<Shown>();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  // Focus handle: the element that last had focus in the player area (PlayerView focuses its own
  // region on mount), else the area itself.
  const playerArea = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  useImperativeHandle(
    handleRef,
    () => ({
      focus() {
        const area = playerArea.current;
        const target =
          lastFocused.current?.isConnected && area?.contains(lastFocused.current)
            ? lastFocused.current
            : area;
        target?.focus({ preventScroll: true });
      },
    }),
    [],
  );

  // Resolve the selected channel: debounced for zaps, latest wins.
  useEffect(() => {
    let current = true;
    const run = () => {
      resolveStream(selection.channel, source).then(
        (outcome) => {
          if (!current) return;
          setResult({ selection, attempt, outcome });
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
          setResult({ selection, attempt, outcome: { status: 'error', error } });
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

  // A retry (new `attempt`) shows the pending state again until its own result arrives.
  const outcome =
    result?.selection === selection && result.attempt === attempt ? result.outcome : undefined;
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

  // Only the errors the player gave up on reach Live (LIV-05 AC3): its automatic reconnects are
  // not failures of the channel. The player's own overlay explains them — including the
  // "restricted by the provider" case of entries with required headers (LIV-05 AC1).
  const onFinalError = useCallback((error: PlaybackError) => {
    log.info('live: channel playback failed', { kind: error.kind, status: error.status });
  }, []);

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
          requiredHeaders={shown.requiredHeaders}
          onFinalError={onFinalError}
          overlay={overlay}
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
        <Box
          ref={playerArea}
          tabIndex={-1}
          onFocus={(event) => {
            // The "Channels" panel lives inside the player now (LIV-05): it is not where focus
            // returns to once it closes.
            if (event.target.closest(`[${CHANNELS_PANEL_ATTRIBUTE}]`)) return;
            lastFocused.current = event.target;
          }}
          sx={{ position: 'absolute', inset: 0, '&:focus': { outline: 'none' } }}
        >
          {body}
        </Box>
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
        {/* In the player (and its fullscreen element) once a stream is shown; here until then. */}
        {!(shown && (!outcome || outcome.status === 'ok')) && overlay}
      </Box>
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
