// Full-content system state (UX-02, docs/UX_UI.md §5): empty, no results, error and offline.
// Every feature renders these states through this component — no ad-hoc variants.
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import SearchOff from '@mui/icons-material/SearchOff';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';
import { redact } from '@/core/log';
import { t } from '@/i18n';

export type StateViewVariant = 'empty' | 'error' | 'offline' | 'no-results';

export interface StateViewProps {
  variant: StateViewVariant;
  title: string;
  message?: string | undefined;
  /** Buttons/links (keyboard-reachable controls). The first one is the primary action. */
  actions?: ReactNode;
  /**
   * Technical text for the "Details" disclosure (usually `describeError(...).details`).
   * Redacted again here as defence in depth.
   */
  details?: string | undefined;
  /** Heading level: 1 when the state replaces a whole screen, 2 (default) inside a screen. */
  headingLevel?: 1 | 2 | 3;
}

const ICONS = {
  empty: InboxOutlined,
  'no-results': SearchOff,
  error: ErrorOutlineOutlined,
  offline: CloudOffOutlined,
} as const;

export function StateView({
  variant,
  title,
  message,
  actions,
  details,
  headingLevel = 2,
}: StateViewProps) {
  const titleId = useId();
  const Icon = ICONS[variant];
  const isError = variant === 'error';
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      data-variant={variant}
      sx={{ maxWidth: 560, mx: 'auto', py: 6, px: 2, textAlign: 'center' }}
    >
      <Icon
        aria-hidden
        sx={{ fontSize: 48, mb: 2, color: isError ? 'error.main' : 'text.secondary' }}
      />
      {/* Only the title and message form the live region: actions and details are not
          announced as part of the alert/status. */}
      <Box role={isError ? 'alert' : 'status'}>
        <Typography id={titleId} variant={`h${headingLevel}`} gutterBottom>
          {title}
        </Typography>
        {message !== undefined && <Typography color="text.secondary">{message}</Typography>}
      </Box>
      {actions && (
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ mt: 3, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          {actions}
        </Stack>
      )}
      {details !== undefined && details !== '' && (
        <Box component="details" sx={{ mt: 3, textAlign: 'start' }}>
          <Box
            component="summary"
            sx={{ cursor: 'pointer', color: 'text.secondary', typography: 'body2' }}
          >
            {t.state.details}
          </Box>
          <Box
            component="pre"
            sx={{
              mt: 1,
              p: 2,
              borderRadius: 1,
              bgcolor: 'background.paper',
              typography: 'caption',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {redact(details)}
          </Box>
        </Box>
      )}
    </Box>
  );
}
