// Confirmation before "Clear history" (FAV-02 AC3): says what is removed and that favorites stay.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId } from 'react';
import { t } from '@/i18n';

export interface ClearHistoryDialogProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Called once the dialog has fully closed (focus is then placed by the screen). */
  onExited?: () => void;
}

export function ClearHistoryDialog({
  open,
  busy,
  onCancel,
  onConfirm,
  onExited,
}: ClearHistoryDialogProps) {
  const text = t.favorites.clearHistory;
  const titleId = useId();
  const messageId = useId();
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onCancel}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      slotProps={{ transition: { onExited } }}
    >
      <DialogTitle id={titleId}>{text.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={messageId}>{text.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          {t.state.cancel}
        </Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={busy}>
          {text.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
