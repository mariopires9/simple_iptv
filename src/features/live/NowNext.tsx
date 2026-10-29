// "Now" (title, times, progress) and "Next" under the playing channel (EPG-01 AC1,
// docs/UX_UI.md §4.3/§4.4). Renders nothing when the channel has no EPG (AC3).
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import type { Channel } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { currentProgramme, nextProgramme, type EpgService, type ShortEpgProgramme } from './epg';
import { formatTime, progressPercent } from './epgFormat';

/** How often the progress bar (and the now/next split) is refreshed. */
export const NOW_NEXT_TICK_MS = 30_000;

export interface NowNextProps {
  epg: EpgService;
  channel: Channel;
  /** Clock (tests). */
  now?: () => number;
}

export function NowNext({ epg, channel, now = Date.now }: NowNextProps) {
  const [loaded, setLoaded] = useState<{
    key: string;
    programmes: readonly ShortEpgProgramme[];
  }>();
  const [tick, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const timer = setInterval(bump, NOW_NEXT_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // (Re)load on a channel change and on every tick: `load` answers from the cache while it is
  // fresh, and asks again once it expired or the current programme ended.
  useEffect(() => {
    const controller = new AbortController();
    epg.load(channel, { signal: controller.signal, priority: true }).then(
      (programmes) => setLoaded({ key: channel.key, programmes }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        log.warn('live: loading now/next failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      },
    );
    return () => controller.abort();
  }, [epg, channel, tick]);

  const programmes = loaded?.key === channel.key ? loaded.programmes : undefined;
  const at = now();
  const current = currentProgramme(programmes, at);
  const next = nextProgramme(programmes, at);
  if (!current && !next) return null;

  return (
    <Box
      component="section"
      aria-label={t.live.epg.region}
      data-testid="now-next"
      sx={{ display: 'grid', gap: 0.5, px: { xs: 0.5, sm: 0 } }}
    >
      {current && (
        <Line label={t.live.epg.now} programme={current}>
          <LinearProgress
            variant="determinate"
            value={progressPercent(current.start, current.end, at)}
            aria-label={t.live.epg.progress(current.title)}
            sx={{ gridColumn: '1 / -1', height: 4, borderRadius: 2 }}
          />
        </Line>
      )}
      {next && <Line label={t.live.epg.next} programme={next} />}
    </Box>
  );
}

function Line({
  label,
  programme,
  children,
}: {
  label: string;
  programme: ShortEpgProgramme;
  children?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto auto minmax(0, 1fr)',
        columnGap: 1,
        rowGap: 0.5,
        alignItems: 'baseline',
      }}
    >
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
      >
        {t.live.epg.times(formatTime(programme.start), formatTime(programme.end))}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        title={programme.description}
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {programme.title}
      </Typography>
      {children}
    </Box>
  );
}
