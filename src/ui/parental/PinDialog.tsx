// PIN prompt of parental control (SEC-03): unlocks restricted content for the session.
// Reads the `parental` strings (the routes that render it load them).
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useId, useState, type FormEvent } from 'react';
import { PIN_MAX_LENGTH, unlockParental } from '@/core/session/parental';
import { log } from '@/core/log';
import { t } from '@/i18n';

export interface PinDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the right PIN unlocked the session. */
  onUnlocked?: (() => void) | undefined;
}

export function PinDialog({ open, onClose, onUnlocked }: PinDialogProps) {
  const text = t.parental.prompt;
  const titleId = useId();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPin('');
    setError(undefined);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (await unlockParental(pin)) {
        setPin('');
        setError(undefined);
        onUnlocked?.();
        onClose();
      } else {
        setPin('');
        setError(text.wrong);
      }
    } catch (failure) {
      log.warn('parental: the PIN could not be checked', {
        error: failure instanceof Error ? failure.name : 'unknown',
      });
      setError(text.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogTitle id={titleId}>{text.title}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            margin="dense"
            type="password"
            label={text.pin}
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH))
            }
            error={error !== undefined}
            helperText={error}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: PIN_MAX_LENGTH } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{text.cancel}</Button>
          <Button type="submit" variant="contained" disabled={busy || pin === ''}>
            {text.unlock}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
