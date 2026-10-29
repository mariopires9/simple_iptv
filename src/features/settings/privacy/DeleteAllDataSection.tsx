// Settings › Privacy › "Delete all data" (SRC-10): explanation, then a dialog where the user types
// the localized confirmation word (DELETE / APAGAR). While deleting the dialog cannot be dismissed;
// on success the app restarts on onboarding, on a partial failure it says what was not deleted and
// offers to retry (AC3).
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { ProgressPanel } from '@/ui/state';
import {
  appRestart,
  deleteAllData as defaultDeleteAllData,
  type DeleteAllDataResult,
  type DeleteStep,
} from './deleteAllData';

export interface DeleteAllDataSectionProps {
  /** Tests: the deletion and the restart. */
  deleteAllData?: () => Promise<DeleteAllDataResult>;
  restart?: () => void;
}

type Phase = { kind: 'confirm' } | { kind: 'deleting' } | { kind: 'failed'; failed: DeleteStep[] };

/** Whether `typed` is the confirmation word (surrounding spaces and letter case ignored). */
export function matchesConfirmWord(typed: string, word: string): boolean {
  return typed.trim().toUpperCase() === word.toUpperCase();
}

export function DeleteAllDataSection({
  deleteAllData = () => defaultDeleteAllData(),
  restart = () => appRestart.restartOnOnboarding(),
}: DeleteAllDataSectionProps) {
  const text = t.settings.privacy.deleteAll;
  const headingId = useId();
  const titleId = useId();
  const messageId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });
  const word = text.dialog.confirmWord;
  const deleting = phase.kind === 'deleting';
  const confirmed = matchesConfirmWord(typed, word);

  function close() {
    if (deleting) return;
    setOpen(false);
  }

  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (deleting || (phase.kind === 'confirm' && !confirmed)) return;
    setPhase({ kind: 'deleting' });
    const result = await deleteAllData();
    if (result.failed.length === 0) {
      restart();
      return;
    }
    setPhase({ kind: 'failed', failed: result.failed });
  }

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 4 }}>
      <Typography id={headingId} variant="h2" sx={{ mb: 1 }}>
        {text.title}
      </Typography>
      <Typography sx={{ mb: 2 }}>{text.description}</Typography>
      <Button
        variant="outlined"
        color="error"
        onClick={() => {
          setTyped('');
          setPhase({ kind: 'confirm' });
          setOpen(true);
        }}
        sx={{ minHeight: 44 }}
      >
        {text.action}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        maxWidth="xs"
        fullWidth
      >
        <Box component="form" noValidate onSubmit={(event) => void run(event)}>
          <DialogTitle id={titleId}>
            {phase.kind === 'failed' ? text.failed.title : text.dialog.title}
          </DialogTitle>
          <DialogContent>
            {phase.kind === 'failed' ? (
              <Box data-testid="delete-all-failure" role="alert">
                <DialogContentText id={messageId}>{text.failed.message}</DialogContentText>
                <Typography variant="subtitle2" component="h3" sx={{ mt: 2 }}>
                  {text.failed.partsTitle}
                </Typography>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 3 }}>
                  {phase.failed.map((step) => (
                    <Typography component="li" variant="body2" key={step}>
                      {text.failed.parts[step]}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ) : (
              <>
                <DialogContentText id={messageId} sx={{ mb: 2 }}>
                  {text.dialog.message}
                </DialogContentText>
                <TextField
                  label={text.dialog.confirmLabel(word)}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  disabled={deleting}
                  autoComplete="off"
                  fullWidth
                  slotProps={{
                    htmlInput: {
                      autoCapitalize: 'characters',
                      autoCorrect: 'off',
                      spellCheck: false,
                    },
                  }}
                />
                {deleting && (
                  <Box sx={{ mt: 2 }}>
                    <ProgressPanel phase={text.dialog.deleting} />
                  </Box>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={deleting}>
              {phase.kind === 'failed' ? text.failed.close : t.state.cancel}
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="error"
              disabled={deleting || (phase.kind === 'confirm' && !confirmed)}
            >
              {phase.kind === 'failed' ? text.failed.retry : text.dialog.confirm}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
