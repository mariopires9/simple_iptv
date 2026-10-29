// Movie player area (VOD-02 AC3): resolves the movie's stream and hands it to the lazily loaded
// PlayerView (kind 'vod', `startAt` = the saved position). Saving the position is VOD-03.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Movie, Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { StateView, errorDetails } from '@/ui/state';
import { resolveMovieStream, type ResolvedMovie } from './resolveMovie';

// The player UI (and, through it, the controller) is loaded on demand (PLY-02 lazy boundary).
const PlayerView = lazy(async () => {
  const ui = await import('@/player/ui');
  return { default: ui.PlayerView };
});

type Outcome = ResolvedMovie | { status: 'error'; error: unknown };

export interface MoviePlayerProps {
  source: Source;
  movie: Movie;
  /** Resume position (seconds). */
  startAt: number | undefined;
  /** Container extension from `get_vod_info`, when the catalogue has none. */
  infoExt: string | undefined;
  onClose: () => void;
}

export function MoviePlayer({ source, movie, startAt, infoExt, onClose }: MoviePlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; outcome: Outcome }>();

  useEffect(() => {
    let current = true;
    resolveMovieStream(movie, source, { infoExt }).then(
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
  }, [movie, source, infoExt, attempt]);

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
