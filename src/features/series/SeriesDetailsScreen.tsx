// Series details (SER-02, SER-03, docs/UX_UI.md §4.7): the shared details header (backdrop, cover,
// title, year · seasons · genre · ★ rating, synopsis, director/cast) with "Continue S2 E5" /
// "Play S1 E1" (+ "Start from the beginning" when resuming) and ★, then the season selector and
// the episode list. Playing opens the episode player above the header; at the end of an episode it
// offers the next one (crossing seasons).
//
// - The series comes from the active list's catalogue (`/series/:seriesId`, the provider's id).
// - Xtream seasons/episodes: `get_series_info`, cached 24 h (seriesDetails.ts); a failure keeps the
//   catalogue data and offers Retry. M3U: seasons/episodes stored at import (VOD-04).
// - Progress: one history entry per episode + the series entry (seriesHistory.ts).
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  catalogRepo,
  favoritesRepo,
  isProtectedStream,
  isProtectedItem,
  itemKey,
  parseCategoryKey,
  type Episode,
  type Series,
  type SeriesDetails as SeriesDetailsRecord,
  type Source,
} from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { openedFromGrid } from '@/ui/catalog/browseState';
import { resolveActiveSource } from '@/ui/catalog/catalogSource';
import { ALL_CATEGORY_ID } from '@/ui/catalog/categories';
import { DetailsHero } from '@/ui/catalog/DetailsHero';
import { formatClock, formatInteger } from '@/ui/catalog/format';
import { useFavoriteToggle } from '@/ui/catalog/useFavoriteToggle';
import { useActiveSource } from '@/ui/hooks/useActiveSource';
import { ParentalGate } from '@/ui/parental';
import {
  DelayedLoading,
  DetailHeaderSkeleton,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { resumePosition, type ProgressSnapshot } from '@/ui/vod/resume';
import { categoryPath, seriesBrowse } from './browseState';
import { SeasonsPanel } from './EpisodeList';
import { EpisodePlayer } from './EpisodePlayer';
import {
  continueTarget,
  nextEpisode,
  orderSeasons,
  playOrder,
  playableSeasons,
  type EpisodeProgress,
} from './episodes';
import { loadSeriesDetails } from './seriesDetails';
import { loadSeriesHistory, type SeriesHistory } from './seriesHistory';

type ScreenState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ready';
      source: Source;
      series: Series;
      history: SeriesHistory;
      favorite: boolean;
    };

type InfoState =
  | { status: 'loading' }
  | { status: 'ok'; details: SeriesDetailsRecord }
  | { status: 'failed'; error: unknown };

async function loadScreen(seriesId: string): Promise<ScreenState> {
  const source = await resolveActiveSource();
  if (!source) return { status: 'not-found' };
  let key: string;
  try {
    key = itemKey(source.id, 'series', seriesId);
  } catch {
    return { status: 'not-found' };
  }
  const [series, favorite] = await Promise.all([
    catalogRepo.get('series', key),
    favoritesRepo.has(key),
  ]);
  if (!series) return { status: 'not-found' };
  const history = await loadSeriesHistory(series);
  return { status: 'ready', source, series, history, favorite };
}

/** Fallback of "Back to series": the series' category (else the last one) with the last sort. */
export function backTarget(series: Series | undefined): { pathname: string; search: string } {
  const last = seriesBrowse.last();
  const parsed = series?.categoryKey ? parseCategoryKey(series.categoryKey) : undefined;
  const categoryId = parsed?.externalId ?? last?.categoryId ?? ALL_CATEGORY_ID;
  return { pathname: categoryPath(categoryId), search: last?.search ?? '' };
}

export function SeriesDetailsScreen() {
  const { seriesId = '' } = useParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; screen: ScreenState }>();
  const requestKey = `${seriesId}\n${attempt}`;

  useEffect(() => {
    let cancelled = false;
    loadScreen(seriesId).then(
      (screen) => {
        if (!cancelled) setState({ key: requestKey, screen });
      },
      (error: unknown) => {
        if (!cancelled) setState({ key: requestKey, screen: { status: 'error', error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [seriesId, requestKey]);
  const screen: ScreenState = state?.key === requestKey ? state.screen : { status: 'loading' };

  // SRC-08 AC4: another list became active → this series belongs to the previous one.
  const active = useActiveSource();
  const seenActive = useRef<{ id: string | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!active.known) return;
    const previous = seenActive.current;
    seenActive.current = { id: active.id };
    if (previous === undefined || previous.id === active.id) return;
    navigate(categoryPath(ALL_CATEGORY_ID), { replace: true });
  }, [active.known, active.id, navigate]);

  // Back: opened from the grid → history back (category, sort and scroll are restored there).
  const location = useLocation();
  const fromGrid = openedFromGrid(location.state, seriesBrowse);
  const back = (
    <Button
      component={Link}
      to={backTarget(screen.status === 'ready' ? screen.series : undefined)}
      onClick={(event: MouseEvent) => {
        if (!fromGrid) return;
        event.preventDefault();
        void navigate(-1);
      }}
      startIcon={<ArrowBackRounded aria-hidden />}
      sx={{ alignSelf: 'flex-start', minHeight: 44 }}
    >
      {t.series.details.back}
    </Button>
  );

  const texts = t.series.details;
  let content;
  switch (screen.status) {
    case 'loading':
      content = (
        <DelayedLoading>
          <DetailHeaderSkeleton />
        </DelayedLoading>
      );
      break;
    case 'not-found':
      content = (
        <StateView
          variant="empty"
          headingLevel={1}
          title={texts.notFound.title}
          message={texts.notFound.message}
        />
      );
      break;
    case 'error':
      content = (
        <StateView
          variant="error"
          headingLevel={1}
          title={texts.loadError.title}
          message={texts.loadError.message}
          details={errorDetails(screen.error)}
          actions={
            <Button variant="contained" onClick={() => setAttempt((n) => n + 1)}>
              {t.state.actions.retry}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      // Parental control (SEC-03): a restricted series needs the PIN before it is shown or played.
      content = (
        <ParentalGate categoryKey={screen.series.categoryKey} headingLevel={1}>
          <SeriesDetails key={screen.series.key} {...screen} />
        </ParentalGate>
      );
      break;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {back}
      {content}
    </Box>
  );
}

interface SeriesDetailsProps {
  source: Source;
  series: Series;
  history: SeriesHistory;
  favorite: boolean;
}

function SeriesDetails({ source, series, history, favorite: initialFavorite }: SeriesDetailsProps) {
  const texts = t.series.details;

  // --- seasons and episodes ---------------------------------------------------------------------
  const [infoAttempt, setInfoAttempt] = useState(0);
  const [info, setInfo] = useState<{ attempt: number; state: InfoState }>();
  useEffect(() => {
    const controller = new AbortController();
    loadSeriesDetails(source, series, { signal: controller.signal }).then(
      (details) => {
        if (!controller.signal.aborted) {
          setInfo({ attempt: infoAttempt, state: { status: 'ok', details } });
        }
      },
      (error: unknown) => {
        // Unmounted (or Retry): aborted on purpose.
        if (controller.signal.aborted) return;
        // Never the URL or the credentials: only the error's name.
        log.warn('series: get_series_info failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        setInfo({ attempt: infoAttempt, state: { status: 'failed', error } });
      },
    );
    return () => controller.abort();
  }, [source, series, infoAttempt]);
  const infoState: InfoState = info?.attempt === infoAttempt ? info.state : { status: 'loading' };
  const details = infoState.status === 'ok' ? infoState.details : undefined;
  // Regular seasons ascending, specials (season 0) last: tabs, default tab and playing order.
  const seasons = useMemo(() => orderSeasons(details?.seasons ?? []), [details]);
  const extra = details?.info;
  // UX-07: the whole series is protected when it was flagged at import (every episode DRM/DASH)
  // or every episode known now is; a mixed series marks its episode rows only. "Continue", the
  // next episode and auto-advance only ever pick from the playable episodes.
  const order = useMemo(() => playOrder(seasons), [seasons]);
  const seriesProtected = useMemo(
    () => isProtectedItem(series) || (order.length > 0 && order.every(isProtectedStream)),
    [series, order],
  );
  const playable = useMemo(
    () => (seriesProtected ? [] : playableSeasons(seasons)),
    [seasons, seriesProtected],
  );

  // --- progress -----------------------------------------------------------------------------------
  const [seriesEntry, setSeriesEntry] = useState(history.entry);
  const [progress, setProgress] = useState<ReadonlyMap<string, EpisodeProgress>>(history.episodes);
  // A save started by the player can finish after this screen is gone (closing it unmounts both).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onSaved = useCallback(
    (episode: Episode, snapshot: ProgressSnapshot) => {
      if (!mounted.current) return;
      setProgress((previous) => new Map(previous).set(episode.key, snapshot));
      // Same rule as seriesHistory.ts: a finished episode points the series at the next one.
      const next = snapshot.completed ? nextEpisode(playable, episode.key) : undefined;
      setSeriesEntry({
        itemKey: series.key,
        sourceId: series.sourceId,
        type: 'series',
        completed: snapshot.completed && next === undefined,
        lastWatchedAt: Date.now(),
        episodeKey: next?.key ?? episode.key,
      });
    },
    [series.key, series.sourceId, playable],
  );
  const target = useMemo(
    () => continueTarget(playable, seriesEntry, progress),
    [playable, seriesEntry, progress],
  );

  // --- season selection ---------------------------------------------------------------------------
  const [chosenSeason, setChosenSeason] = useState<number>();
  const selectedSeason = chosenSeason ?? target?.episode.season ?? seasons[0]?.number ?? 0;

  // --- playback -----------------------------------------------------------------------------------
  const [playing, setPlaying] = useState<{ episode: Episode; startAt: number | undefined }>();
  const mainButton = useRef<HTMLButtonElement>(null);
  const play = useCallback(
    (episode: Episode, startAt: number | undefined) => {
      // UX-07: a protected (DRM/DASH) episode is never opened in the player.
      if (isProtectedStream(episode)) return;
      setPlaying({ episode, startAt });
      setChosenSeason(episode.season);
    },
    [setPlaying, setChosenSeason],
  );
  const playFromProgress = useCallback(
    (episode: Episode) => play(episode, resumePosition(progress.get(episode.key))),
    [play, progress],
  );
  const closePlayer = useCallback(() => {
    setPlaying(undefined);
    queueMicrotask(() => mainButton.current?.focus());
  }, [setPlaying]);

  const {
    favorite,
    toggle: toggleFavorite,
    announcement,
  } = useFavoriteToggle(series.key, series.name, initialFavorite, texts);

  const meta: string[] = [];
  const year = extra?.year ?? series.year;
  if (year !== undefined) meta.push(String(year));
  if (seasons.length > 0)
    meta.push(texts.seasonCount(seasons.length, formatInteger(seasons.length)));
  const genre = extra?.genre ?? series.genre;
  if (genre !== undefined) meta.push(genre);
  const poster = series.cover ?? extra?.cover;
  const titleId = useId();
  const protectedNoteId = useId();

  const code = (episode: Episode) =>
    [formatInteger(episode.season), formatInteger(episode.number)] as const;
  let actions = null;
  const firstEpisode = order[0];
  if (!target && seriesProtected && firstEpisode) {
    // No playable episode left: Play stays, disabled, pointing at the hero's explanation.
    const [s, e] = code(firstEpisode);
    actions = (
      <Button
        ref={mainButton}
        variant="contained"
        size="large"
        startIcon={<PlayArrowRounded aria-hidden />}
        disabled
        aria-describedby={protectedNoteId}
        sx={{ minHeight: 44 }}
      >
        {texts.playEpisode(s, e)}
      </Button>
    );
  } else if (target) {
    const [s, e] = code(target.episode);
    const resumeAt = target.kind === 'continue' ? target.resumeAt : undefined;
    actions = (
      <>
        <Button
          ref={mainButton}
          variant="contained"
          size="large"
          startIcon={<PlayArrowRounded aria-hidden />}
          onClick={() => play(target.episode, resumeAt)}
          sx={{ minHeight: 44 }}
        >
          {target.kind === 'continue' ? texts.continueEpisode(s, e) : texts.playEpisode(s, e)}
        </Button>
        {resumeAt !== undefined && (
          <Button
            variant="outlined"
            size="large"
            startIcon={<ReplayRounded aria-hidden />}
            onClick={() => play(target.episode, undefined)}
            sx={{ minHeight: 44 }}
          >
            {texts.startOver}
          </Button>
        )}
      </>
    );
  }
  const resumeNote =
    target?.kind === 'continue' && target.resumeAt !== undefined
      ? texts.resumeAt(formatClock(target.resumeAt))
      : undefined;

  const playingEpisode = playing?.episode;
  // The next playable episode (protected ones are skipped by auto-advance).
  const next = playingEpisode ? nextEpisode(playable, playingEpisode.key) : undefined;

  let episodesView;
  if (infoState.status === 'loading') {
    episodesView = (
      <DelayedLoading>
        <Typography sx={{ mt: 3, color: 'text.secondary' }}>{texts.infoLoading}</Typography>
      </DelayedLoading>
    );
  } else if (infoState.status === 'failed') {
    episodesView = (
      <StateView
        variant="error"
        title={texts.infoFailed.title}
        message={texts.infoFailed.message}
        details={errorDetails(infoState.error)}
        actions={
          <Button variant="contained" onClick={() => setInfoAttempt((n) => n + 1)}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else if (playOrder(seasons).length === 0) {
    episodesView = (
      <StateView
        variant="empty"
        title={texts.noEpisodes.title}
        message={texts.noEpisodes.message}
      />
    );
  } else {
    episodesView = (
      <SeasonsPanel
        seasons={seasons}
        selected={selectedSeason}
        onSelect={setChosenSeason}
        progress={progress}
        playingKey={playingEpisode?.key}
        onPlay={playFromProgress}
      />
    );
  }

  return (
    <Box component="article" aria-labelledby={titleId} sx={{ position: 'relative' }}>
      {playing && (
        <Box sx={{ mb: 2 }}>
          <EpisodePlayer
            key={playing.episode.key}
            source={source}
            series={series}
            episode={playing.episode}
            next={next}
            startAt={playing.startAt}
            onSaved={onSaved}
            onAdvance={playFromProgress}
            onClose={closePlayer}
          />
        </Box>
      )}
      <DetailsHero
        title={series.name}
        titleId={titleId}
        poster={poster}
        backdrop={extra?.backdrop ?? poster}
        meta={meta}
        rating={extra?.rating ?? series.rating}
        plot={extra?.plot ?? series.plot}
        director={extra?.director}
        cast={extra?.cast}
        texts={texts}
        testIdPrefix="series"
        protectedNoteId={seriesProtected ? protectedNoteId : undefined}
        actions={
          <>
            {actions}
            <Button
              variant="outlined"
              size="large"
              aria-pressed={favorite}
              startIcon={favorite ? <StarRounded aria-hidden /> : <StarBorderRounded aria-hidden />}
              onClick={toggleFavorite}
              sx={{ minHeight: 44 }}
            >
              {favorite ? texts.removeFavorite : texts.addFavorite}
            </Button>
          </>
        }
        footer={
          resumeNote !== undefined && (
            <Typography
              variant="body2"
              data-testid="series-resume-note"
              sx={{ color: 'text.secondary' }}
            >
              {resumeNote}
            </Typography>
          )
        }
      />
      {episodesView}
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
