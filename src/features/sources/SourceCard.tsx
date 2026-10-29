// One list on "My lists" (SRC-08, docs/UX_UI.md §4.1b): name, ACTIVE badge, type and counts,
// last sync, status with a short reason, and the actions (use, refresh with progress, edit,
// remove). Status is conveyed by text and icon, never by colour alone.
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, type Ref } from 'react';
import { Link } from 'react-router';
import type { Source } from '@/core/db';
import { activeLocale, t, type Locale } from '@/i18n';
import { ProgressPanel } from '@/ui/state';
import {
  describeContents,
  describeLastSync,
  describeStatus,
  type SourceStatusTone,
} from './format';
import type { SourceSyncProgress } from './sourceSync';

const STATUS_ICONS: Record<SourceStatusTone, typeof InfoOutlined> = {
  neutral: InfoOutlined,
  ok: CheckCircleOutlineRounded,
  warning: WarningAmberRounded,
  error: ErrorOutlineRounded,
};

const STATUS_COLORS: Record<SourceStatusTone, string> = {
  neutral: 'text.secondary',
  ok: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
};

type PhaseKey = keyof typeof t.sources.myLists.phases;

/** Localized text of a worker sync phase. */
export function phaseText(phase: string | undefined): string {
  const phases = t.sources.myLists.phases;
  return phase !== undefined && Object.hasOwn(phases, phase)
    ? phases[phase as PhaseKey]
    : phases.starting;
}

export interface SourceCardProps {
  source: Source;
  active: boolean;
  /** Reference time for "Updated … ago". */
  now: number;
  /** Progress of a running sync of this list. */
  sync: SourceSyncProgress | undefined;
  onUse: (source: Source) => void;
  onRefresh: (source: Source) => void;
  onCancelRefresh: (source: Source) => void;
  onRemove: (source: Source) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  locale?: Locale;
}

export function SourceCard({
  source,
  active,
  now,
  sync,
  onUse,
  onRefresh,
  onCancelRefresh,
  onRemove,
  headingRef,
  locale = activeLocale(),
}: SourceCardProps) {
  const text = t.sources.myLists;
  const headingId = useId();
  const status = sync
    ? { tone: 'neutral' as const, text: text.status.syncing }
    : describeStatus(source, t, locale);
  const StatusIcon = STATUS_ICONS[status.tone];
  const refreshable = source.kind !== 'm3u-file';

  return (
    <Box
      component="article"
      aria-labelledby={headingId}
      data-testid={`source-card-${source.id}`}
      sx={{
        p: 2,
        borderRadius: 3,
        bgcolor: 'tokens.surface1',
        border: 1,
        borderColor: active ? 'primary.main' : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          variant="h3"
          component="h2"
          sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', outline: 'none' }}
        >
          {source.name}
        </Typography>
        {active && (
          <Chip
            label={text.active}
            color="primary"
            size="small"
            sx={{ textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}
          />
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {describeContents(source, t, locale)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {describeLastSync(source, now, t, locale)}
      </Typography>
      <Box
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 0.5 }}
        data-testid="source-status"
        data-tone={status.tone}
      >
        <StatusIcon
          aria-hidden
          fontSize="small"
          sx={{ color: STATUS_COLORS[status.tone], mt: 0.125 }}
        />
        <Typography variant="body2">{status.text}</Typography>
      </Box>

      {sync && (
        <Box sx={{ mt: 1.5 }}>
          <ProgressPanel
            phase={phaseText(sync.phase)}
            count={sync.done}
            total={sync.total}
            onCancel={() => onCancelRefresh(source)}
            cancelling={sync.cancelling}
          />
        </Box>
      )}

      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: 'wrap' }}>
        {!active && (
          <Button variant="contained" onClick={() => onUse(source)} aria-describedby={headingId}>
            {text.actions.use}
          </Button>
        )}
        {refreshable && (
          <Button
            variant="outlined"
            onClick={() => onRefresh(source)}
            disabled={sync !== undefined}
            aria-describedby={headingId}
          >
            {text.actions.refresh}
          </Button>
        )}
        <Button
          component={Link}
          to={`/settings/sources/${encodeURIComponent(source.id)}/edit`}
          aria-describedby={headingId}
        >
          {text.actions.edit}
        </Button>
        <Button color="error" onClick={() => onRemove(source)} aria-describedby={headingId}>
          {text.actions.remove}
        </Button>
      </Stack>
    </Box>
  );
}
