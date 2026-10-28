// Full-content status message (docs/UX_UI.md §5): title, short text and actions. Used by the
// not-found screen, the route error boundary and the "storage unavailable" start-up screen.
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';

export interface StatusViewProps {
  title: string;
  message: string;
  actions?: ReactNode;
}

export function StatusView({ title, message, actions }: StatusViewProps) {
  const titleId = useId();
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{ maxWidth: 560, mx: 'auto', py: 6, textAlign: 'center' }}
    >
      <Typography id={titleId} variant="h1" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">{message}</Typography>
      {actions && (
        <Stack
          direction="row"
          spacing={2}
          sx={{ mt: 3, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          {actions}
        </Stack>
      )}
    </Box>
  );
}

/** Wraps content that renders without the AppShell (start-up errors, full-screen routes). */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Box sx={{ width: '100%' }}>{children}</Box>
    </Box>
  );
}
