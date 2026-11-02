import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';
import { useSectionExpanded } from './sectionState';

/**
 * One Settings section: a labelled region with an `h2`. Every section uses it (UX-04). On the
 * Settings screen the heading is a disclosure button and the content starts collapsed (UX-08).
 */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  const contentId = useId();
  const disclosure = useSectionExpanded();
  const expanded = disclosure?.expanded ?? true;
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ maxWidth: 720, py: 2 }}>
      <Typography id={headingId} variant="h2" sx={{ mb: expanded ? 1 : 0 }}>
        {disclosure ? (
          <ButtonBase
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={disclosure.toggle}
            sx={{
              width: '100%',
              justifyContent: 'space-between',
              font: 'inherit',
              textAlign: 'start',
              borderRadius: 1,
              py: 0.5,
            }}
          >
            {title}
            <ExpandMoreRounded
              aria-hidden
              sx={{
                transition: 'transform 150ms',
                transform: expanded ? 'rotate(180deg)' : 'none',
              }}
            />
          </ButtonBase>
        ) : (
          title
        )}
      </Typography>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
      <Divider sx={{ mt: 2 }} />
    </Box>
  );
}
