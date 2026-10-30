// VOD player area (VOD-02 AC3, VOD-03, SER-03; shared by Movies and Series since SER-03): resolves
// the item's stream ONCE per mount and per Retry, hands it to the lazily loaded PlayerView (kind
// 'vod', `startAt` = the resume position) and saves the playback position (useProgressSaver.ts).
// Resolution problems (DRM/DASH, unreadable password, no address, errors) are shown in place.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import type { UrlRewriter } from '@/core/net';
import { rewritersForSource } from '@/core/session';
import { t } from '@/i18n';
import { StateView, errorDetails } from '@/ui/state';
import type { ResolvedVod } from './resolveVod';
import type { ProgressSnapshot } from './resume';
import { useProgressSaver } from './useProgressSaver';

// The player UI (and, through it, the controller) is loaded on demand (PLY-02 lazy boundary).
const PlayerView = lazy(async () => {
  const ui = await import('@/player/ui');
  return { default: ui.PlayerView };
});

type Outcome = ResolvedVod | { status: 'error'; error: unknown };
/** A resolved stream with the list's playback rewriter (personal proxy, PRX-01). */
type Resolved = { outcome: Outcome; rewriter?: UrlRewriter };

export interface VodPlayerTexts {
  loading: (name: string) => string;
  unsupported: { title: string; message: string };
  credentials: { title: string; message: string; action: string };
  unavailable: { title: string; message: string };
  resolveError: { title: string; message: string };
}

export interface VodPlayerProps {
  /** The item's list: its proxy routing (PRX-01) is read with each resolution. */
  source: Pick<Source, 'prefs'>;
  title: string;
  /**
   * Resolves the stream. Called once per mount and per Retry (read through a ref: a new function
   * never reloads the player). Remount (React `key`) to play something else.
   */
  resolve: () => Promise<ResolvedVod>;
  /** Resume position (seconds). */
  startAt: number | undefined;
  /** Saves the playback position (VOD-03): every 10 s, on pause, end, exit. */
  onProgress?: ((snapshot: ProgressSnapshot) => void) | undefined;
  onClose: () => void;
  /** Rendered over the video inside the player region (e.g. the next-episode card). */
  overlay?: ReactNode;
  /** The <video> element once mounted (`null` when it goes). */
  onVideoElement?: ((video: HTMLVideoElement | null) => void) | undefined;
  texts: VodPlayerTexts;
  /** Test id of the 16:9 frame. */
  testId: string;
  /** Feature prefix of the log messages (`movies`, `series`). */
  logPrefix: string;
}

export function VodPlayer({
  source,
  title,
  resolve,
  startAt,
  onProgress,
  onClose,
  overlay,
  onVideoElement,
  texts,
  testId,
  logPrefix,
}: VodPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number } & Resolved>();
  const resolveRef = useRef(resolve);
  const sourceRef = useRef(source);
  const onVideoRef = useRef(onVideoElement);
  useEffect(() => {
    resolveRef.current = resolve;
    sourceRef.current = source;
    onVideoRef.current = onVideoElement;
  });

  useEffect(() => {
    let current = true;
    Promise.all([resolveRef.current(), rewritersForSource(sourceRef.current)]).then(
      ([outcome, rewriters]) => {
        if (current) setResult({ attempt, outcome, rewriter: rewriters.playback });
      },
      (error: unknown) => {
        if (!current) return;
        // Never the URL or the credentials: only the error's name.
        log.warn(`${logPrefix}: resolving the stream failed`, {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setResult({ attempt, outcome: { status: 'error', error } });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, logPrefix]);

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const handleVideo = useCallback((element: HTMLVideoElement | null) => {
    setVideo(element);
    onVideoRef.current?.(element);
  }, []);
  useProgressSaver(video, onProgress);

  const outcome = result?.attempt === attempt ? result.outcome : undefined;
  let body: ReactNode;
  if (!outcome) {
    body = <Pending text={texts.loading(title)} />;
  } else if (outcome.status === 'ok') {
    body = (
      <Suspense fallback={<Pending text={texts.loading(title)} />}>
        <PlayerView
          descriptor={outcome.descriptor}
          title={title}
          kind="vod"
          startAt={startAt}
          onClose={onClose}
          overlay={overlay}
          onVideoElement={handleVideo}
          {...(result?.rewriter ? { rewriter: result.rewriter } : {})}
        />
      </Suspense>
    );
  } else {
    body = (
      <ResolveProblem outcome={outcome} texts={texts} onRetry={() => setAttempt((n) => n + 1)} />
    );
  }

  return (
    <Box
      data-testid={testId}
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

function Pending({ text }: { text: string }) {
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
      <Typography variant="subtitle1">{text}</Typography>
    </Box>
  );
}

function ResolveProblem({
  outcome,
  texts,
  onRetry,
}: {
  outcome: Exclude<Outcome, { status: 'ok' }>;
  texts: VodPlayerTexts;
  onRetry: () => void;
}) {
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
