// Confirmation before removing a list (SRC-08 AC3): names the list and what is deleted.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId } from 'react';
import { t } from '@/i18n';

export interface RemoveSourceDialogProps {
  /** Name of the list to remove; the dialog is open while set. */
  name: string | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** The list was removed: focus is not returned to its (gone) Remove button. */
  removed?: boolean;
  /** Called once the dialog has fully closed. */
  onExited?: () => void;
}

export function RemoveSourceDialog({
  name,
  busy,
  onCancel,
  onConfirm,
  removed = false,
  onExited,
}: RemoveSourceDialogProps) {
  const text = t.sources.myLists.remove;
  const titleId = useId();
  const messageId = useId();
  return (
    <Dialog
      open={name !== undefined}
      onClose={busy ? undefined : onCancel}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      disableRestoreFocus={removed}
      slotProps={{ transition: { onExited } }}
    >
      <DialogTitle id={titleId}>{text.title(name ?? '')}</DialogTitle>
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
