import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

/** Wraps content that renders without the AppShell (start-up errors, full-screen routes). */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Box sx={{ width: '100%' }}>{children}</Box>
    </Box>
  );
}
