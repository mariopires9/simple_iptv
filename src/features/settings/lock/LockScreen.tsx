// SEC-02: unlock screen. A full-screen modal dialog (focus trapped, the app behind it inert),
// shown on open while a master password is set and again after the background timeout. No
// recovery: "forgot the password" is the existing "Delete all data" (SRC-10).
// Loaded lazily (src/app/App.tsx) only when a master password is set, with the `lock` strings.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LockRounded from '@mui/icons-material/LockRounded';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { unlockVault } from '@/core/session';
import { t } from '@/i18n';
import { DeleteAllDataSection } from '../privacy/DeleteAllDataSection';

export interface LockScreenProps {
  /** Tests: the unlock. Default: `unlockVault` (core/session). */
  unlock?: (password: string) => Promise<void>;
}

type Failure = 'wrong' | 'failed' | undefined;

export function LockScreen({ unlock = unlockVault }: LockScreenProps) {
  const text = t.lock.screen;
  const titleId = useId();
  const messageId = useId();
  const errorId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const input = useRef<HTMLInputElement>(null);
  // The password field gets the focus once the dialog's focus trap has settled.
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await unlock(password);
      // Unmounted by the app once the vault reports `unlocked`.
    } catch (error) {
      setFailure(
        error instanceof Error && error.name === 'WrongMasterPasswordError' ? 'wrong' : 'failed',
      );
      setPassword('');
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <Dialog
      open
      fullScreen
      aria-labelledby={titleId}
      aria-describedby={messageId}
      data-testid="lock-screen"
    >
      <Box
        sx={{
          maxWidth: 420,
          width: '100%',
          mx: 'auto',
          px: 2,
          py: { xs: 4, sm: 8 },
        }}
      >
        <LockRounded aria-hidden sx={{ fontSize: 48, mb: 2 }} color="primary" />
        <Typography id={titleId} variant="h1" component="h1" gutterBottom>
          {text.title}
        </Typography>
        <Typography id={messageId} sx={{ mb: 3 }}>
          {text.message}
        </Typography>
        <Box component="form" noValidate onSubmit={(event) => void submit(event)}>
          <TextField
            inputRef={input}
            type="password"
            label={text.password}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={busy}
            fullWidth
            error={failure !== undefined}
            slotProps={{
              htmlInput: failure ? { 'aria-describedby': errorId } : {},
            }}
          />
          {failure && (
            <Alert id={errorId} severity="error" role="alert" sx={{ mt: 2 }}>
              {failure === 'wrong' ? text.wrong : text.failed}
            </Alert>
          )}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={busy || password.length === 0}
            sx={{ mt: 2, minHeight: 44 }}
          >
            {busy ? text.unlocking : text.unlock}
          </Button>
        </Box>
        <Typography variant="h2" sx={{ mt: 6, mb: 1 }}>
          {text.forgotTitle}
        </Typography>
        <Typography color="text.secondary">{text.forgotMessage}</Typography>
        <DeleteAllDataSection />
      </Box>
    </Dialog>
  );
}
