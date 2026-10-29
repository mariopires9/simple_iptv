// Picking a local M3U file (SRC-06): the native file input (hidden, opened by a button so it can
// carry the app's styling and label) and the confirmation for large files (AC2).
import Button, { type ButtonProps } from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId, useRef, type Ref } from 'react';
import { t } from '@/i18n';
import { formatBytes } from '@/ui/format';

/** SRC-06 AC1: what the picker offers. */
export const M3U_FILE_ACCEPT = '.m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl';

/** SRC-06 AC2: files above 50 MB (decimal, as `formatBytes` shows sizes) take long to read. */
export const LARGE_FILE_BYTES = 50 * 1000 * 1000;

export const isLargeFile = (file: Blob): boolean => file.size > LARGE_FILE_BYTES;

export interface M3uFilePickerProps {
  /** Text of the button (also the accessible name of the input). */
  label: string;
  onPick: (file: File) => void;
  disabled?: boolean;
  /** Ids of elements describing the button (help text, error). */
  describedBy?: string | undefined;
  buttonRef?: Ref<HTMLButtonElement>;
  variant?: ButtonProps['variant'];
}

/** A button that opens the system file picker for M3U files. */
export function M3uFilePicker({
  label,
  onPick,
  disabled = false,
  describedBy,
  buttonRef,
  variant = 'outlined',
}: M3uFilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  return (
    <>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={M3U_FILE_ACCEPT}
        aria-label={label}
        data-testid="m3u-file-input"
        hidden
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Cleared so that picking the same file again is still a change.
          event.currentTarget.value = '';
          if (file) onPick(file);
        }}
      />
      <Button
        ref={buttonRef}
        variant={variant}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => input.current?.click()}
        sx={{ minHeight: 44 }}
      >
        {label}
      </Button>
    </>
  );
}

export interface LargeFileDialogProps {
  open: boolean;
  /** Size of the file waiting for confirmation (bytes); kept while the dialog closes. */
  size: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** SRC-06 AC2: "This file is 80 MB. Reading it may take several minutes…" — continue or cancel. */
export function LargeFileDialog({ open, size, onConfirm, onCancel }: LargeFileDialogProps) {
  const text = t.sources.addM3uFile.largeFile;
  const titleId = useId();
  const messageId = useId();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId}>{text.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={messageId}>{text.message(formatBytes(size))}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t.state.cancel}</Button>
        <Button variant="contained" onClick={onConfirm}>
          {text.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
