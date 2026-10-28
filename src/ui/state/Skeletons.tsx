// Content-shaped loading placeholders (UX-02, docs/UX_UI.md §5 "Loading: skeletons shaped like
// the content"). The shapes are decorative (`aria-hidden`); the container is `aria-busy` and
// carries a visually hidden "Loading…" label. Wrap them in `DelayedLoading` so short loads do not
// flash.
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { visuallyHidden } from './visuallyHidden';

/** Height of a channel row (px), shared with the channel list (LIV-01). */
export const CHANNEL_ROW_HEIGHT = 64;

export interface SkeletonContainerProps {
  children: ReactNode;
  /** Overrides the "Loading…" label read by screen readers. */
  label?: string;
}

/** `aria-busy` wrapper: one hidden label for assistive technology, decorative shapes inside. */
export function SkeletonContainer({ children, label = t.state.loading }: SkeletonContainerProps) {
  return (
    <Box aria-busy="true" data-testid="skeleton">
      <Box component="span" sx={visuallyHidden}>
        {label}
      </Box>
      <Box aria-hidden="true">{children}</Box>
    </Box>
  );
}

function ChannelRowShape() {
  return (
    <Box sx={{ height: CHANNEL_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 2, px: 2 }}>
      <Skeleton variant="rounded" width={40} height={40} sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="35%" />
      </Box>
    </Box>
  );
}

export interface CountProps {
  /** Number of placeholder items. */
  count?: number;
  label?: string;
}

/** List of 64 px channel rows (logo + name + current programme). */
export function ChannelListSkeleton({ count = 8, label }: CountProps) {
  return (
    <SkeletonContainer label={label}>
      {Array.from({ length: count }, (_, i) => (
        <ChannelRowShape key={i} />
      ))}
    </SkeletonContainer>
  );
}

export interface PosterGridSkeletonProps extends CountProps {
  /** Minimum poster width (px) for the responsive grid. */
  minWidth?: number;
}

/** Responsive grid of 2:3 posters with a title line. */
export function PosterGridSkeleton({ count = 12, label, minWidth = 120 }: PosterGridSkeletonProps) {
  return (
    <SkeletonContainer label={label}>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <Box key={i}>
            <Skeleton
              variant="rounded"
              data-shape="poster"
              sx={{ width: '100%', height: 'auto', aspectRatio: '2 / 3' }}
            />
            <Skeleton variant="text" width="80%" />
          </Box>
        ))}
      </Box>
    </SkeletonContainer>
  );
}

/** Movie/series detail header: poster + title, metadata line, synopsis lines and actions. */
export function DetailHeaderSkeleton({ label }: Pick<CountProps, 'label'>) {
  return (
    <SkeletonContainer label={label}>
      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Skeleton
          variant="rounded"
          data-shape="poster"
          sx={{ width: { xs: 160, sm: 200 }, height: 'auto', aspectRatio: '2 / 3', flexShrink: 0 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Skeleton variant="text" sx={{ typography: 'h1' }} width="70%" />
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" />
          <Skeleton variant="text" />
          <Skeleton variant="text" width="85%" />
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Skeleton variant="rounded" width={120} height={44} />
            <Skeleton variant="rounded" width={120} height={44} />
          </Box>
        </Box>
      </Box>
    </SkeletonContainer>
  );
}
