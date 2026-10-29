// Card of a channel, movie or series on Home and Favorites (docs/UX_UI.md §4.6): artwork with a
// tonal fallback, the name and, for "Continue watching", a 3 px progress bar and the episode.
// A local card on the shared `@/ui` artwork helpers: there is no shared card component yet (the
// Live row and the Movies poster stay in their features).
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { forwardRef, useState, type FocusEventHandler, type ReactNode } from 'react';
import { Link } from 'react-router';
import { activeLocale, t } from '@/i18n';
import { colorsForName } from '@/ui/colorHash';
import { isLoadableImage } from '@/ui/images';
import { visuallyHidden } from '@/ui/state';
import { avatarPalette, radii } from '@/ui/theme/tokens';
import type { CardItem } from './data';

/** Card widths (px) per breakpoint (xs / sm / md). */
export const CARD_WIDTH = { xs: 112, sm: 144, md: 168 } as const;

/** 0–1 as a whole percentage in the active locale ("40%", pt-PT "40 %"). */
function formatPercent(fraction: number): string {
  return new Intl.NumberFormat(activeLocale(), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
}

/** Decorative artwork (the name is always rendered as text): square for channels, else 2:3. */
export function Artwork({
  item,
}: {
  item: Pick<CardItem, 'name' | 'image' | 'type' | 'progress'>;
}) {
  const theme = useTheme();
  const [failedUrl, setFailedUrl] = useState<string>();
  const showImage = isLoadableImage(item.image) && failedUrl !== item.image;
  const tone = colorsForName(item.name, avatarPalette[theme.palette.mode]);
  const square = item.type === 'live';
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: square ? '1 / 1' : '2 / 3',
        borderRadius: `${radii.md}px`,
        overflow: 'hidden',
        bgcolor: 'tokens.surface2',
      }}
    >
      {showImage ? (
        <Box
          component="img"
          src={item.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(item.image)}
          sx={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: square ? 'contain' : 'cover',
            p: square ? 1.5 : 0,
          }}
        />
      ) : (
        <Box
          aria-hidden="true"
          data-testid="artwork-fallback"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 1,
            textAlign: 'center',
            bgcolor: tone.bg,
            color: tone.fg,
            typography: 'body2',
            fontWeight: 600,
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        >
          {item.name}
        </Box>
      )}
      {item.progress !== undefined && (
        <Box
          aria-hidden="true"
          data-testid="card-progress"
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            bgcolor: 'tokens.surface3',
          }}
        >
          <Box
            sx={{ height: '100%', bgcolor: 'primary.main' }}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }}
          />
        </Box>
      )}
    </Box>
  );
}

/** Name (2 lines) and secondary line under the artwork. */
export function CardText({ name, secondary }: { name: string; secondary?: ReactNode }) {
  return (
    <>
      <Typography
        component="span"
        variant="body2"
        className="card-name"
        sx={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          mt: 1,
          fontWeight: 500,
          wordBreak: 'break-word',
        }}
      >
        {name}
      </Typography>
      {secondary !== undefined && (
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block' }}
        >
          {secondary}
        </Typography>
      )}
    </>
  );
}

export interface ItemCardProps {
  item: CardItem;
  tabIndex?: number;
  onFocus?: FocusEventHandler<HTMLAnchorElement>;
}

/** The card as a link to the item. */
export const ItemCard = forwardRef<HTMLAnchorElement, ItemCardProps>(function ItemCard(
  { item, tabIndex, onFocus },
  ref,
) {
  const text = t.favorites;
  const episode =
    item.episode === undefined ? undefined : text.episode(item.episode.season, item.episode.number);
  return (
    <Box
      component={Link}
      ref={ref}
      to={item.href}
      tabIndex={tabIndex}
      onFocus={onFocus}
      data-card-link=""
      sx={{
        display: 'block',
        color: 'text.primary',
        textDecoration: 'none',
        borderRadius: `${radii.md}px`,
        '&:hover img, &:hover [data-testid="artwork-fallback"]': { opacity: 0.85 },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Artwork item={item} />
      <CardText name={item.name} secondary={episode} />
      {item.progress !== undefined && (
        <Box component="span" sx={visuallyHidden}>
          {text.watched(formatPercent(item.progress))}
        </Box>
      )}
    </Box>
  );
});
