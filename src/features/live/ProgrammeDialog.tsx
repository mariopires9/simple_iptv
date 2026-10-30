// Details of a programme chosen in the guide grid (EPG-04): title, channel, day and times,
// description, and "Watch channel". Programme text is untrusted: rendered as React text only.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
import { isProtectedItem, type Channel } from '@/core/db';
import { t } from '@/i18n';
import { ProtectedBadge } from '@/ui/catalog/ProtectedBadge';
import type { ShortEpgProgramme } from './epg';
import { formatDay, formatTime } from './epgFormat';

export interface ProgrammeDialogProps {
  selection: { channel: Channel; programme: ShortEpgProgramme } | undefined;
  onClose: () => void;
  onWatch: (channel: Channel) => void;
}

export function ProgrammeDialog({ selection, onClose, onWatch }: ProgrammeDialogProps) {
  const titleId = useId();
  if (!selection) return null;
  const { channel, programme } = selection;
  const protectedContent = isProtectedItem(channel);
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{programme.title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t.live.guide.details.channel(channel.name)}
        </Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', mb: 2 }}>
          {`${formatDay(programme.start)} · ${t.live.epg.times(
            formatTime(programme.start),
            formatTime(programme.end),
          )}`}
        </Typography>
        <Typography variant="body1" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
          {programme.description ?? t.live.guide.details.noDescription}
        </Typography>
        {protectedContent && <ProtectedBadge />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.live.guide.details.close}</Button>
        <Button variant="contained" disabled={protectedContent} onClick={() => onWatch(channel)}>
          {t.live.guide.details.watch}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
