import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { mainLandmarkProps } from '../shell/SkipLink';

/** Wraps content that renders without the AppShell (start-up errors, full-screen routes). */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <Box
      component="main"
      {...mainLandmarkProps}
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        '&:focus': { outline: 'none' },
      }}
    >
      <Box sx={{ width: '100%' }}>{children}</Box>
    </Box>
  );
}
