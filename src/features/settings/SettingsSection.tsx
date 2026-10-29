import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';

/** One Settings section: a labelled region with an `h2`. Every section uses it (UX-04). */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ maxWidth: 720, py: 2 }}>
      <Typography id={headingId} variant="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
      <Divider sx={{ mt: 2 }} />
    </Box>
  );
}
