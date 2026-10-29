// Movie player area (VOD-02 AC3): resolves the movie's stream and hands it to the lazily loaded
// PlayerView (kind 'vod', `startAt` = the saved position). Saving the position is VOD-03.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Movie, Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { StateView, errorDetails } from '@/ui/state';
import { needsInfoExt, resolveMovieStream, type ResolvedMovie } from './resolveMovie';

// The player UI (and, through it, the controller) is loaded on demand (PLY-02 lazy boundary).
const PlayerView = lazy(async () => {
  const ui = await import('@/player/ui');
  return { default: ui.PlayerView };
});

type Outcome = ResolvedMovie | { status: 'error'; error: unknown };

/** How long Play waits for `get_vod_info` when the catalogue has no extension (ms). */
export const INFO_WAIT_MS = 3_000;

export interface MoviePlayerProps {
  source: Source;
  movie: Movie;
  /** Resume position (seconds). */
  startAt: number | undefined;
  /**
   * The container extension from `get_vod_info` once the details settle (`undefined` when they
   * have none or failed). Only asked when the catalogue has no extension (`needsInfoExt`).
   */
  getInfoExt: () => Promise<string | undefined>;
  /** Upper bound of the wait for `getInfoExt` before falling back. Default {@link INFO_WAIT_MS}. */
  infoWaitMs?: number;
  onClose: () => void;
}

/** The details' extension, or `undefined` after `ms` (the resolver then uses its fallback). */
function waitForExt(get: () => Promise<string | undefined>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([get().catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolves the stream ONCE per mount (one Play press) and per Retry: details that arrive later
 * never reload the player. `getInfoExt` is read through a ref for that reason.
 */
export function MoviePlayer({
  source,
  movie,
  startAt,
  getInfoExt,
  infoWaitMs = INFO_WAIT_MS,
  onClose,
}: MoviePlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; outcome: Outcome }>();
  const infoExt = useRef(getInfoExt);
  useEffect(() => {
    infoExt.current = getInfoExt;
  });

  useEffect(() => {
    let current = true;
    const ext = needsInfoExt(movie, source)
      ? waitForExt(() => infoExt.current(), infoWaitMs)
      : Promise.resolve(undefined);
    ext
      .then((found) => resolveMovieStream(movie, source, { infoExt: found }))
      .then(
        (outcome) => {
          if (current) setResult({ attempt, outcome });
        },
        (error: unknown) => {
          if (!current) return;
          log.warn('movies: resolving the stream failed', {
            error: error instanceof Error ? error.name : 'unknown',
          });
          setResult({ attempt, outcome: { status: 'error', error } });
        },
      );
    return () => {
      current = false;
    };
  }, [movie, source, infoWaitMs, attempt]);

  const outcome = result?.attempt === attempt ? result.outcome : undefined;
  let body: ReactNode;
  if (!outcome) {
    body = <Pending name={movie.name} />;
  } else if (outcome.status === 'ok') {
    body = (
      <Suspense fallback={<Pending name={movie.name} />}>
        <PlayerView
          descriptor={outcome.descriptor}
          title={movie.name}
          kind="vod"
          startAt={startAt}
          onClose={onClose}
        />
      </Suspense>
    );
  } else {
    body = <ResolveProblem outcome={outcome} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  return (
    <Box
      data-testid="movie-player"
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        maxHeight: '70vh',
        bgcolor: 'common.black',
        color: 'common.white',
        borderRadius: { xs: 2, sm: 3 },
        overflow: 'hidden',
      }}
    >
      {body}
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
      <Typography variant="subtitle1">{t.movies.player.loading(name)}</Typography>
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
  const texts = t.movies.player;
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
