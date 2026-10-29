// Seasons and episodes of the series details (SER-02, docs/UX_UI.md §4.6 episode row, §4.7):
// a season selector (tabs, or a dropdown above 6 seasons) and the season's episode rows
// ("E03 · Title", duration, optional 16:9 still, progress bar or ✓ watched). A row plays its
// episode (from its saved position when worth resuming).
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { useId, useState } from 'react';
import type { Episode, Season } from '@/core/db';
import { t } from '@/i18n';
import { formatDuration, formatInteger, formatPercent } from '@/ui/catalog/format';
import { isLoadableImage } from '@/ui/images';
import { visuallyHidden } from '@/ui/state';
import { episodeName } from './EpisodePlayer';
import { customSeasonName, episodeState, type EpisodeProgress } from './episodes';

/** Above this many seasons the selector is a dropdown (docs/UX_UI.md §4.7). */
export const MAX_SEASON_TABS = 6;

export function seasonLabel(season: Pick<Season, 'number' | 'name'>): string {
  return customSeasonName(season) ?? t.series.details.season(formatInteger(season.number));
}

export interface SeasonsPanelProps {
  seasons: readonly Season[];
  selected: number;
  onSelect: (season: number) => void;
  progress: ReadonlyMap<string, EpisodeProgress>;
  /** The episode playing, if any (marked on its row). */
  playingKey: string | undefined;
  onPlay: (episode: Episode) => void;
}

export function SeasonsPanel({
  seasons,
  selected,
  onSelect,
  progress,
  playingKey,
  onPlay,
}: SeasonsPanelProps) {
  const texts = t.series.details;
  const base = useId();
  const season = seasons.find((s) => s.number === selected) ?? seasons[0];
  if (!season) return null;
  const tabId = (n: number) => `${base}-tab-${n}`;
  const panelId = `${base}-panel`;
  const useTabs = seasons.length <= MAX_SEASON_TABS;

  return (
    <Box component="section" aria-label={texts.seasons} sx={{ mt: 3 }}>
      {useTabs ? (
        <Tabs
          value={season.number}
          onChange={(_, value: number) => onSelect(value)}
          aria-label={texts.seasons}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 1 }}
        >
          {seasons.map((s) => (
            <Tab
              key={s.number}
              value={s.number}
              label={seasonLabel(s)}
              id={tabId(s.number)}
              aria-controls={panelId}
              sx={{ minHeight: 48 }}
            />
          ))}
        </Tabs>
      ) : (
        <TextField
          select
          size="small"
          label={texts.seasons}
          value={season.number}
          onChange={(event) => onSelect(Number(event.target.value))}
          sx={{ minWidth: 220, mb: 1 }}
          slotProps={{ select: { native: true } }}
        >
          {seasons.map((s) => (
            <option key={s.number} value={s.number}>
              {seasonLabel(s)}
            </option>
          ))}
        </TextField>
      )}
      <Box
        id={panelId}
        {...(useTabs ? { role: 'tabpanel', 'aria-labelledby': tabId(season.number) } : {})}
      >
        <Box
          component="ul"
          aria-label={texts.episodesOf(seasonLabel(season))}
          sx={{ m: 0, p: 0, listStyle: 'none' }}
        >
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={episode.key}
              episode={episode}
              progress={progress.get(episode.key)}
              playing={episode.key === playingKey}
              onPlay={onPlay}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

interface EpisodeRowProps {
  episode: Episode;
  progress: EpisodeProgress | undefined;
  playing: boolean;
  onPlay: (episode: Episode) => void;
}

function EpisodeRow({ episode, progress, playing, onPlay }: EpisodeRowProps) {
  const texts = t.series.details;
  const state = episodeState(progress);
  const duration = formatDuration(episode.durationSec, texts);
  const code = texts.episodeCode(formatInteger(episode.number).padStart(2, '0'));
  const [imageFailed, setImageFailed] = useState(false);
  const still = !imageFailed && isLoadableImage(episode.image) ? episode.image : undefined;
  const fraction = state.kind === 'progress' ? state.fraction : undefined;

  return (
    <Box component="li" data-testid="episode-row">
      <ListItemButton
        onClick={() => onPlay(episode)}
        aria-current={playing ? 'true' : undefined}
        sx={{ minHeight: 72, gap: 2, borderRadius: 2, alignItems: 'center' }}
      >
        {still !== undefined ? (
          <Box
            component="img"
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            sx={{
              width: 96,
              aspectRatio: '16 / 9',
              objectFit: 'cover',
              borderRadius: 1,
              flexShrink: 0,
              display: { xs: 'none', sm: 'block' },
            }}
          />
        ) : (
          <PlayArrowRounded aria-hidden sx={{ color: 'text.secondary', flexShrink: 0 }} />
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Box
            component="span"
            sx={{ typography: 'body1', fontWeight: 600, wordBreak: 'break-word' }}
          >
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {code}
            </Box>
            {' · '}
            {episodeName(episode)}
          </Box>
          {duration !== undefined && (
            <Box component="span" sx={{ typography: 'body2', color: 'text.secondary' }}>
              {duration}
            </Box>
          )}
          {fraction !== undefined && (
            <Box
              aria-hidden="true"
              data-testid="episode-progress"
              sx={{ height: 3, bgcolor: 'tokens.surface3', borderRadius: 1, maxWidth: 240 }}
            >
              <Box
                sx={{ height: '100%', bgcolor: 'primary.main', borderRadius: 1 }}
                style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }}
              />
            </Box>
          )}
          {fraction !== undefined && (
            <Box component="span" sx={visuallyHidden}>
              {`, ${texts.progress(formatPercent(fraction))}`}
            </Box>
          )}
        </Box>
        {state.kind === 'watched' && (
          <Box
            component="span"
            data-testid="episode-watched"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}
          >
            <CheckCircleRounded aria-hidden fontSize="small" />
            <Box component="span" sx={{ typography: 'body2' }}>
              {texts.watched}
            </Box>
          </Box>
        )}
      </ListItemButton>
    </Box>
  );
}
