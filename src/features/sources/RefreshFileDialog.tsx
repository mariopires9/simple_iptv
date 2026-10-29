// "Refresh" of a list added from a local file (SRC-06 AC3): there is no URL to download again, so
// the user picks the updated file; a file over 50 MB is confirmed first (AC2, `LargeFileDialog`).
// The parent keys it by list id (a large file waiting for confirmation never carries over to
// another list) and keeps passing the list name while it closes.
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId, useState } from 'react';
import { t } from '@/i18n';
import { isLargeFile, LargeFileDialog, M3uFilePicker } from './m3u/filePicker';

export interface RefreshFileDialogProps {
  open: boolean;
  /** Name of the list being refreshed (kept by the parent during the close transition). */
  name: string;
  /** The file to import (already confirmed when large). */
  onPick: (file: File) => void;
  onCancel: () => void;
}

export function RefreshFileDialog({ open, name, onPick, onCancel }: RefreshFileDialogProps) {
  const text = t.sources.myLists.refreshFile;
  const titleId = useId();
  const messageId = useId();
  /** A large file waiting for confirmation. */
  const [pending, setPending] = useState<File | undefined>();
  /** Its size, kept while the confirmation closes. */
  const [pendingSize, setPendingSize] = useState(0);

  function pick(file: File) {
    if (!isLargeFile(file)) {
      onPick(file);
      return;
    }
    setPendingSize(file.size);
    setPending(file);
  }

  function cancel() {
    setPending(undefined);
    onCancel();
  }

  function confirmLarge() {
    const file = pending;
    setPending(undefined);
    if (file) onPick(file);
  }

  return (
    <>
      <Dialog
        open={open && pending === undefined}
        onClose={cancel}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id={titleId}>{text.title(name)}</DialogTitle>
        <DialogContent>
          <DialogContentText id={messageId}>{text.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancel}>{t.state.cancel}</Button>
          <M3uFilePicker label={text.choose} onPick={pick} variant="contained" />
        </DialogActions>
      </Dialog>
      <LargeFileDialog
        open={open && pending !== undefined}
        size={pendingSize}
        onConfirm={confirmLarge}
        onCancel={cancel}
      />
    </>
  );
}
