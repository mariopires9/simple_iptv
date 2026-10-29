// Header of the movie and series details (VOD-02, SER-02, docs/UX_UI.md §4.7; shared since
// SER-02): blurred backdrop at the top, poster, title, meta line (year · duration · genre ·
// ★ rating), the feature's actions (Play/Resume, ★), the synopsis (3 lines + "More") and the
// director/cast list. Missing fields are simply not rendered — no empty labels or separators.
// Every server text is rendered as React text (never HTML), so markup stays inert.
import StarRounded from '@mui/icons-material/StarRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isLoadableImage } from '@/ui/images';
import { visuallyHidden } from '@/ui/state';
import { formatRating } from './format';
import { Poster } from './Poster';

/** Plots longer than this always get "More" (layout measurement is not available everywhere). */
export const LONG_PLOT = 240;

export interface DetailsHeroTexts {
  /** Accessible text of the rating, e.g. "Rating 7.1 out of 10". */
  rating: (rating: string) => string;
  synopsis: string;
  more: string;
  less: string;
  director: string;
  cast: string;
}

export interface DetailsHeroProps {
  title: string;
  /** Id of the title heading (the article's accessible name). */
  titleId: string;
  poster?: string | undefined;
  backdrop?: string | undefined;
  /** Meta parts in order (year, duration, genre…); the rating follows them. */
  meta: readonly string[];
  rating?: number | undefined;
  actions: ReactNode;
  plot?: string | undefined;
  director?: string | undefined;
  cast?: string | undefined;
  /** Below everything (e.g. "Couldn't load more details"). */
  footer?: ReactNode;
  texts: DetailsHeroTexts;
  /** Prefix of the test ids (`movie` → `movie-meta`, `movie-plot`, `movie-backdrop`). */
  testIdPrefix: string;
}

export function DetailsHero({
  title,
  titleId,
  poster,
  backdrop,
  meta,
  rating,
  actions,
  plot,
  director,
  cast,
  footer,
  texts,
  testIdPrefix,
}: DetailsHeroProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const plotRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [plot, expanded]);
  const plotId = useId();
  const canExpand = plot !== undefined && (overflowing || plot.length > LONG_PLOT);

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 4,
        overflow: 'hidden',
        bgcolor: 'tokens.surface1',
        p: { xs: 2, sm: 3 },
      }}
    >
      {isLoadableImage(backdrop) && (
        // Decorative blurred backdrop at the top (≤ 40 % of the viewport height).
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            inset: 0,
            bottom: 'auto',
            height: '40vh',
            maxHeight: '100%',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <Box
            component="img"
            src={backdrop}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            data-testid={`${testIdPrefix}-backdrop`}
            sx={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'blur(24px)',
              opacity: 0.35,
              transform: 'scale(1.1)',
            }}
          />
        </Box>
      )}
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', sm: '200px minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Box sx={{ width: { xs: 160, sm: 200 } }}>
          <Poster title={title} url={poster} width={200} eager />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
          <Typography id={titleId} variant="h3" component="h1" sx={{ wordBreak: 'break-word' }}>
            {title}
          </Typography>
          {(meta.length > 0 || rating !== undefined) && (
            <Box
              data-testid={`${testIdPrefix}-meta`}
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 0.5,
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {meta.map((part, i) => (
                <Box component="span" key={i}>
                  {i > 0 && (
                    <Box component="span" aria-hidden="true" sx={{ mr: 1 }}>
                      ·
                    </Box>
                  )}
                  {part}
                </Box>
              ))}
              {rating !== undefined && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                  {meta.length > 0 && (
                    <Box component="span" aria-hidden="true" sx={{ mr: 1 }}>
                      ·
                    </Box>
                  )}
                  <StarRounded aria-hidden fontSize="small" sx={{ mr: 0.5 }} />
                  <Box component="span" aria-hidden="true">
                    {formatRating(rating)}
                  </Box>
                  <Box component="span" sx={visuallyHidden}>
                    {texts.rating(formatRating(rating))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>{actions}</Box>
          {plot !== undefined && (
            <Box>
              <Typography component="h2" variant="h6" sx={visuallyHidden}>
                {texts.synopsis}
              </Typography>
              <Typography
                ref={plotRef}
                id={plotId}
                data-testid={`${testIdPrefix}-plot`}
                sx={{
                  whiteSpace: 'pre-line',
                  wordBreak: 'break-word',
                  ...(!expanded && {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }),
                }}
              >
                {plot}
              </Typography>
              {canExpand && (
                <Button
                  size="small"
                  aria-expanded={expanded}
                  aria-controls={plotId}
                  onClick={() => setExpanded((e) => !e)}
                  sx={{ mt: 0.5, minHeight: 44 }}
                >
                  {expanded ? texts.less : texts.more}
                </Button>
              )}
            </Box>
          )}
          {(director !== undefined || cast !== undefined) && (
            <Box component="dl" sx={{ m: 0, display: 'grid', gap: 0.5 }}>
              {director !== undefined && (
                <Box>
                  <Box component="dt" sx={{ display: 'inline', color: 'text.secondary', mr: 1 }}>
                    {texts.director}
                  </Box>
                  <Box component="dd" sx={{ display: 'inline', m: 0 }}>
                    {director}
                  </Box>
                </Box>
              )}
              {cast !== undefined && (
                <Box>
                  <Box component="dt" sx={{ display: 'inline', color: 'text.secondary', mr: 1 }}>
                    {texts.cast}
                  </Box>
                  <Box component="dd" sx={{ display: 'inline', m: 0 }}>
                    {cast}
                  </Box>
                </Box>
              )}
            </Box>
          )}
          {footer}
        </Box>
      </Box>
    </Box>
  );
}
