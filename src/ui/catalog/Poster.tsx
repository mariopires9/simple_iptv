// 2:3 poster with a tonal fallback (VOD-01 AC3, SER-01, docs/UX_UI.md §4.6): a missing, unloadable
// or failed image becomes a tonal block (stable colour per title) with the title on it. Shared by
// the Movies and Series grids and details since SER-01.
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { useState, type ReactNode } from 'react';
import { colorsForName } from '@/ui/colorHash';
import { isLoadableImage } from '@/ui/images';
import { avatarPalette, radii } from '@/ui/theme/tokens';

export interface PosterProps {
  title: string;
  url?: string | undefined;
  /** Rendered width (px), for the image's intrinsic size. */
  width: number;
  /** Watched fraction (0–1): 3 px progress bar at the bottom ("Continue watching", AC4). */
  progress?: number | undefined;
  /** Eager load (details page). Default lazy. */
  eager?: boolean;
  /** Overlay in a corner, e.g. the "Protected" badge (UX-07). */
  badge?: ReactNode;
}

/** Decorative: the title is always rendered next to it, so the image has an empty `alt`. */
export function Poster({ title, url, width, progress, eager = false, badge }: PosterProps) {
  const theme = useTheme();
  // The URL that failed: a new `url` (e.g. a recycled cell) gets its own attempt.
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = failedUrl !== undefined && failedUrl === url;
  const height = Math.round(width * 1.5);
  const tone = colorsForName(title, avatarPalette[theme.palette.mode]);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: '2 / 3',
        borderRadius: `${radii.md}px`,
        overflow: 'hidden',
        bgcolor: 'tokens.surface2',
        flexShrink: 0,
      }}
    >
      {!failed && isLoadableImage(url) ? (
        <Box
          component="img"
          src={url}
          alt=""
          width={Math.round(width)}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
          sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Box
          aria-hidden="true"
          data-testid="poster-fallback"
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
          <Box
            component="span"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 5,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </Box>
        </Box>
      )}
      {badge}
      {progress !== undefined && (
        <Box
          aria-hidden="true"
          data-testid="poster-progress"
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
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </Box>
      )}
    </Box>
  );
}
