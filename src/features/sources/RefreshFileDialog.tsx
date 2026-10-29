// "Refresh" of a list added from a local file (SRC-06 AC3): there is no URL to download again, so
// the user picks the updated file; a file over 50 MB is confirmed first (AC2).
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId, useState } from 'react';
import { t } from '@/i18n';
import { formatBytes } from '@/ui/format';
import { isLargeFile, M3uFilePicker } from './m3u/filePicker';

export interface RefreshFileDialogProps {
  /** Name of the list being refreshed; the dialog is open while it is set. */
  name: string | undefined;
  /** The file to import (already confirmed when large). */
  onPick: (file: File) => void;
  onCancel: () => void;
}

export function RefreshFileDialog({ name, onPick, onCancel }: RefreshFileDialogProps) {
  const text = t.sources.myLists.refreshFile;
  const large = t.sources.addM3uFile.largeFile;
  const titleId = useId();
  const messageId = useId();
  /** A large file waiting for confirmation. */
  const [pending, setPending] = useState<File | undefined>();

  function pick(file: File) {
    if (isLargeFile(file)) setPending(file);
    else onPick(file);
  }

  return (
    <Dialog
      open={name !== undefined}
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      maxWidth="xs"
      fullWidth
      slotProps={{ transition: { onExited: () => setPending(undefined) } }}
    >
      <DialogTitle id={titleId}>{pending ? large.title : text.title(name ?? '')}</DialogTitle>
      <DialogContent>
        <DialogContentText id={messageId}>
          {pending ? large.message(formatBytes(pending.size)) : text.message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t.state.cancel}</Button>
        {pending ? (
          <Button variant="contained" onClick={() => onPick(pending)}>
            {large.confirm}
          </Button>
        ) : (
          <M3uFilePicker label={text.choose} onPick={pick} variant="contained" />
        )}
      </DialogActions>
    </Dialog>
  );
}
