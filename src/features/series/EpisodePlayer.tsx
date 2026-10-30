// Episode player (SER-03): the shared VOD player (`@/ui/vod/VodPlayer`) with the episode's stream,
// its resume position and progress saving (VOD-03 rules), plus the "Next episode in 10 s" card
// over the video (Cancel / Play now) that moves on — across seasons — to the next episode.
// One instance per episode: the screen remounts it (React `key`) for the next one.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useCallback, useRef, useState } from 'react';
import type { Episode, Series, Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { formatInteger } from '@/ui/catalog/format';
import { visuallyHidden } from '@/ui/state';
import { progressSnapshot, type ProgressSnapshot } from '@/ui/vod/resume';
import { VodPlayer } from '@/ui/vod/VodPlayer';
import { resolveEpisodeStream } from './resolveEpisode';
import { saveEpisodeProgress } from './seriesHistory';
import { useNextEpisode } from './useNextEpisode';

/** Display name of an episode ("Pilot", else "Episode 3"). */
export function episodeName(episode: Pick<Episode, 'title' | 'number'>): string {
  return episode.title !== ''
    ? episode.title
    : t.series.details.episode(formatInteger(episode.number));
}

export interface EpisodePlayerProps {
  source: Source;
  series: Series;
  episode: Episode;
  /** The episode after this one (any season), if any. */
  next: Episode | undefined;
  startAt: number | undefined;
  /** A position was saved (the screen refreshes the episode list). */
  onSaved: (episode: Episode, snapshot: ProgressSnapshot) => void;
  /** Play `next` (from its own resume position). */
  onAdvance: (next: Episode) => void;
  onClose: () => void;
}

export function EpisodePlayer({
  source,
  series,
  episode,
  next,
  startAt,
  onSaved,
  onAdvance,
  onClose,
}: EpisodePlayerProps) {
  const resolve = useCallback(
    () => resolveEpisodeStream(source, series, episode),
    [source, series, episode],
  );

  // Moving on means this episode was watched, even if the credits were skipped: it is saved as
  // completed right away (the player's own saves skip a position they already wrote), and every
  // later save of it (the player closing) keeps it completed.
  const finished = useRef(false);
  const save = useCallback(
    (snapshot: ProgressSnapshot) => {
      const final = finished.current ? { ...snapshot, completed: true } : snapshot;
      saveEpisodeProgress(series, episode, final, next).then(
        () => onSaved(episode, final),
        (error: unknown) =>
          log.warn('series: saving the position failed', {
            error: error instanceof Error ? error.name : 'unknown',
          }),
      );
    },
    [series, episode, next, onSaved],
  );

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const advance = useCallback(() => {
    if (!next) return;
    finished.current = true;
    save(progressSnapshot(video?.currentTime ?? 0, video?.duration, true));
    onAdvance(next);
  }, [next, onAdvance, save, video]);
  const { phase, cancel, playNow } = useNextEpisode(video, next !== undefined, advance);

  const texts = t.series.player;
  const season = formatInteger(episode.season);
  const number = formatInteger(episode.number);
  const overlay =
    next && phase.kind === 'counting' ? (
      <NextEpisodeCard
        next={next}
        seconds={Math.max(0, phase.seconds)}
        onCancel={cancel}
        onPlayNow={playNow}
      />
    ) : undefined;

  return (
    <VodPlayer
      source={source}
      title={texts.title(series.name, season, number, episodeName(episode))}
      resolve={resolve}
      startAt={startAt}
      onProgress={save}
      onClose={onClose}
      overlay={overlay}
      onVideoElement={setVideo}
      texts={texts}
      testId="episode-player"
      logPrefix="series"
    />
  );
}

interface NextEpisodeCardProps {
  next: Episode;
  seconds: number;
  onCancel: () => void;
  onPlayNow: () => void;
}

function NextEpisodeCard({ next, seconds, onCancel, onPlayNow }: NextEpisodeCardProps) {
  const texts = t.series.player.nextEpisode;
  const label = texts.label(
    formatInteger(next.season),
    formatInteger(next.number),
    episodeName(next),
  );
  // Announced once when the card appears, not on every tick.
  const [announcement] = useState(() => `${texts.countdown(formatInteger(seconds))}. ${label}`);
  return (
    <Paper
      role="group"
      aria-label={texts.countdown(formatInteger(seconds))}
      data-testid="next-episode-card"
      elevation={6}
      sx={{
        position: 'absolute',
        right: 16,
        bottom: 88,
        maxWidth: 'calc(100% - 32px)',
        width: 340,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <Box role="status" sx={visuallyHidden}>
        {announcement}
      </Box>
      <Typography variant="subtitle1" aria-hidden sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {texts.countdown(formatInteger(seconds))}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', wordBreak: 'break-word' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} sx={{ minHeight: 44 }}>
          {texts.cancel}
        </Button>
        <Button variant="contained" onClick={onPlayNow} sx={{ minHeight: 44 }}>
          {texts.playNow}
        </Button>
      </Box>
    </Paper>
  );
}
