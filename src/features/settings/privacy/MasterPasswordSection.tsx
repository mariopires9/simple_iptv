// Settings › Privacy › Master password (SEC-02): turn it on (with the explicit no-recovery
// warning and its acknowledgement), lock now, the background lock delay, and turn it off (asks
// for the password). The re-encryption runs while the dialog shows progress and cannot be
// dismissed.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  disableMasterPassword,
  enableMasterPassword,
  getAutoLockMinutes,
  getVaultLockStatus,
  LOCK_MINUTE_CHOICES,
  lockVaultNow,
  MIN_MASTER_PASSWORD_LENGTH,
  setAutoLockMinutes,
  subscribeVaultLock,
} from '@/core/session';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { ProgressPanel, useToast } from '@/ui/state';

export interface MasterPasswordSectionProps {
  /** Tests: the session operations. */
  enable?: (password: string) => Promise<void>;
  disable?: (password: string) => Promise<void>;
}

const isWrongPassword = (error: unknown) =>
  error instanceof Error && error.name === 'WrongMasterPasswordError';

function EnableDialog({
  onClose,
  enable,
}: {
  onClose: () => void;
  enable: (password: string) => Promise<void>;
}) {
  const text = t.lock.settings.enableDialog;
  const titleId = useId();
  const warningId = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const tooShort = password.length < MIN_MASTER_PASSWORD_LENGTH;
  const mismatch = confirm !== password;
  const valid = !tooShort && !mismatch && understood;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await enable(password);
      onClose();
    } catch (error) {
      log.warn('master password: enabling failed', { error });
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      aria-labelledby={titleId}
      aria-describedby={warningId}
      maxWidth="xs"
      fullWidth
    >
      <Box component="form" noValidate onSubmit={(event) => void submit(event)}>
        <DialogTitle id={titleId}>{text.title}</DialogTitle>
        <DialogContent>
          <Alert id={warningId} severity="warning" sx={{ mb: 2 }}>
            {text.warning}
          </Alert>
          <Stack spacing={2}>
            <TextField
              type="password"
              label={text.password}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              disabled={busy}
              error={touched && tooShort}
              helperText={
                touched && tooShort
                  ? text.tooShort(MIN_MASTER_PASSWORD_LENGTH)
                  : text.passwordHint(MIN_MASTER_PASSWORD_LENGTH)
              }
              fullWidth
              sx={{ mt: 1 }}
            />
            <TextField
              type="password"
              label={text.confirm}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              disabled={busy}
              error={touched && mismatch}
              helperText={touched && mismatch ? text.mismatch : undefined}
              fullWidth
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={understood}
                  onChange={(event) => setUnderstood(event.target.checked)}
                  disabled={busy}
                />
              }
              label={text.understand}
            />
          </Stack>
          {busy && (
            <Box sx={{ mt: 2 }}>
              <ProgressPanel phase={text.working} />
            </Box>
          )}
          {failed && (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {text.failed}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t.state.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !understood}>
            {text.submit}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function DisableDialog({
  onClose,
  disable,
}: {
  onClose: () => void;
  disable: (password: string) => Promise<void>;
}) {
  const text = t.lock.settings.disableDialog;
  const titleId = useId();
  const messageId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'wrong' | 'failed'>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await disable(password);
      onClose();
    } catch (error) {
      if (!isWrongPassword(error)) log.warn('master password: disabling failed', { error });
      setFailure(isWrongPassword(error) ? 'wrong' : 'failed');
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      maxWidth="xs"
      fullWidth
    >
      <Box component="form" noValidate onSubmit={(event) => void submit(event)}>
        <DialogTitle id={titleId}>{text.title}</DialogTitle>
        <DialogContent>
          <DialogContentText id={messageId} sx={{ mb: 2 }}>
            {text.message}
          </DialogContentText>
          <TextField
            type="password"
            label={text.password}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={busy}
            error={failure === 'wrong'}
            fullWidth
          />
          {busy && (
            <Box sx={{ mt: 2 }}>
              <ProgressPanel phase={text.working} />
            </Box>
          )}
          {failure && (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {failure === 'wrong' ? text.wrong : text.failed}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t.state.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="error"
            disabled={busy || password.length === 0}
          >
            {text.submit}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function MasterPasswordSection({
  enable = enableMasterPassword,
  disable = disableMasterPassword,
}: MasterPasswordSectionProps) {
  const text = t.lock.settings;
  const headingId = useId();
  const status = useSyncExternalStore(subscribeVaultLock, getVaultLockStatus);
  const [dialog, setDialog] = useState<'enable' | 'disable'>();
  const [minutes, setMinutes] = useState(getAutoLockMinutes);
  const toast = useToast();
  const on = status === 'unlocked' || status === 'locked';

  function changeMinutes(value: number) {
    const previous = minutes;
    setMinutes(value);
    setAutoLockMinutes(value).catch((error: unknown) => {
      log.warn('master password: lock delay not saved', { error });
      setMinutes(previous);
      toast.show({ message: text.saveError, severity: 'error' });
    });
  }

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 4 }}>
      <Typography id={headingId} variant="h2" sx={{ mb: 1 }}>
        {text.title}
      </Typography>
      <Typography sx={{ mb: 2 }}>{on ? text.descriptionOn : text.descriptionOff}</Typography>
      {on ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <TextField
            select
            label={text.lockAfter}
            value={minutes}
            onChange={(event) => changeMinutes(Number(event.target.value))}
            sx={{ minWidth: 240 }}
          >
            {LOCK_MINUTE_CHOICES.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {text.lockAfterChoice(choice)}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button variant="outlined" onClick={lockVaultNow} sx={{ minHeight: 44 }}>
              {text.lockNow}
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => setDialog('disable')}
              sx={{ minHeight: 44 }}
            >
              {text.disable}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button
          variant="outlined"
          onClick={() => setDialog('enable')}
          disabled={status !== 'off'}
          sx={{ minHeight: 44 }}
        >
          {text.enable}
        </Button>
      )}
      {dialog === 'enable' && <EnableDialog enable={enable} onClose={() => setDialog(undefined)} />}
      {dialog === 'disable' && (
        <DisableDialog disable={disable} onClose={() => setDialog(undefined)} />
      )}
    </Box>
  );
}
