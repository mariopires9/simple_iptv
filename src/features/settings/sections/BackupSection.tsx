import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { log } from '@/core/log';
import { intlDateTimeFormat, t } from '@/i18n';
import { formatInteger } from '@/ui/catalog/format';
import { useToast } from '@/ui/state';
import { backupFileName, buildBackup, downloadText, serializeBackup } from '../backup/exportBackup';
import { BackupFileError, type ParsedBackup } from '../backup/format';
import {
  applyBackup,
  BackupImportError,
  backupRestart,
  previewBackup,
  readBackupFile,
  WrongBackupPasswordError,
  type ImportMode,
} from '../backup/importBackup';
import { SettingsSection } from '../SettingsSection';

/** Minimum length of an export password (the KDF does the rest: PBKDF2, 600 000 iterations). */
export const MIN_EXPORT_PASSWORD = 8;

const exportDate = intlDateTimeFormat({ dateStyle: 'long', timeStyle: 'short' });

function ExportForm() {
  const text = t.settings.backup;
  const toast = useToast();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const tooShort = includeSecrets && password.length < MIN_EXPORT_PASSWORD;
  const mismatch = includeSecrets && confirm !== password;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    if (tooShort || mismatch) return;
    setBusy(true);
    try {
      const now = new Date();
      const { file, unreadableSecrets } = await buildBackup({
        ...(includeSecrets ? { password } : {}),
        now,
      });
      downloadText(serializeBackup(file), backupFileName(now));
      setPassword('');
      setConfirm('');
      setSubmitted(false);
      toast.show({
        message: unreadableSecrets > 0 ? text.exportedMissing(unreadableSecrets) : text.exported,
        severity: unreadableSecrets > 0 ? 'info' : 'success',
      });
    } catch (error) {
      log.warn('backup: the export failed', { error });
      toast.show({ message: text.exportError, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} noValidate onSubmit={(e) => void onSubmit(e)}>
      <Typography variant="h3" component="h3" sx={{ typography: 'subtitle1' }}>
        {text.exportTitle}
      </Typography>
      <FormControl>
        <FormControlLabel
          control={
            <Checkbox
              checked={includeSecrets}
              onChange={(event) => setIncludeSecrets(event.target.checked)}
            />
          }
          label={text.includeSecrets}
        />
        <FormHelperText sx={{ mx: 0 }}>{text.includeSecretsHint}</FormHelperText>
      </FormControl>
      {includeSecrets && (
        <>
          <TextField
            label={text.password}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={submitted && tooShort}
            helperText={
              submitted && tooShort
                ? text.errors.tooShort(MIN_EXPORT_PASSWORD)
                : text.passwordHint(MIN_EXPORT_PASSWORD)
            }
            sx={{ maxWidth: 420 }}
          />
          <TextField
            label={text.confirmPassword}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={submitted && !tooShort && mismatch}
            helperText={submitted && !tooShort && mismatch ? text.errors.mismatch : ' '}
            sx={{ maxWidth: 420 }}
          />
        </>
      )}
      <div>
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? text.exporting : text.export}
        </Button>
      </div>
    </Stack>
  );
}

function ImportDialog({ backup, onClose }: { backup: ParsedBackup; onClose: () => void }) {
  const text = t.settings.backup.preview;
  const toast = useToast();
  const titleId = useId();
  const modeLabelId = useId();
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [wrongPassword, setWrongPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The import stopped part-way: only restarting is offered (the stores would be stale). */
  const [partial, setPartial] = useState(false);
  const preview = previewBackup(backup);
  const exportedAt = Date.parse(backup.exportedAt);
  const count = (fn: (n: number, f: string) => string, n: number) => fn(n, formatInteger(n));

  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setWrongPassword(false);
    try {
      await applyBackup(backup, { mode, password });
      backupRestart.restartOnLists();
    } catch (error) {
      if (error instanceof BackupImportError && error.changed) {
        log.warn('backup: the import stopped part-way', { error });
        setPartial(true);
        return;
      }
      setBusy(false);
      if (error instanceof WrongBackupPasswordError) {
        setWrongPassword(true);
        return;
      }
      log.warn('backup: the import failed', { error });
      toast.show({ message: t.settings.backup.importError, severity: 'error' });
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      aria-labelledby={titleId}
      slotProps={{ paper: { component: 'form', onSubmit: (e: FormEvent) => void onConfirm(e) } }}
    >
      <DialogTitle id={titleId}>{text.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {Number.isFinite(exportedAt) && (
            <Typography color="text.secondary">
              {text.exportedAt(exportDate().format(exportedAt))}
            </Typography>
          )}
          <ul data-testid="backup-preview-counts" style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>{count(text.lists, preview.sources)}</li>
            <li>{count(text.favorites, preview.favorites)}</li>
            <li>{count(text.history, preview.history)}</li>
            <li>{count(text.settings, preview.settings)}</li>
          </ul>
          {preview.skipped > 0 && (
            <Alert severity="warning">{count(text.skipped, preview.skipped)}</Alert>
          )}
          <div data-testid="backup-preview-secrets">
            {preview.encrypted ? (
              <Stack spacing={0.5}>
                {preview.sourceSecrets > 0 && (
                  <Typography>{count(text.secretsIncluded, preview.sourceSecrets)}</Typography>
                )}
                {preview.proxyToken && <Typography>{text.proxyTokenIncluded}</Typography>}
              </Stack>
            ) : (
              <Typography>{text.noSecrets}</Typography>
            )}
            {preview.proxyAddressIgnored && <Typography>{text.proxyAddressIgnored}</Typography>}
          </div>
          <Typography variant="body2" color="text.secondary">
            {text.catalogue}
          </Typography>
          {preview.encrypted && (
            <TextField
              label={text.password}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setWrongPassword(false);
              }}
              error={wrongPassword}
              helperText={wrongPassword ? text.wrongPassword : text.passwordHint}
            />
          )}
          <FormControl>
            <FormLabel id={modeLabelId}>{text.mode}</FormLabel>
            <RadioGroup
              aria-labelledby={modeLabelId}
              value={mode}
              onChange={(event) => setMode(event.target.value as ImportMode)}
            >
              <FormControlLabel value="merge" control={<Radio />} label={text.merge} />
              <FormHelperText sx={{ mt: -0.5, mb: 1 }}>{text.mergeHint}</FormHelperText>
              <FormControlLabel value="replace" control={<Radio />} label={text.replace} />
              <FormHelperText sx={{ mt: -0.5 }}>{text.replaceHint}</FormHelperText>
            </RadioGroup>
          </FormControl>
        </Stack>
      </DialogContent>
      {partial && (
        <Alert severity="error" role="alert" sx={{ mx: 3 }}>
          {t.settings.backup.importPartial}
        </Alert>
      )}
      <DialogActions>
        {partial && (
          <Button variant="contained" onClick={() => backupRestart.restartOnLists()}>
            {t.settings.backup.restart}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          {t.state.cancel}
        </Button>
        <Button
          type="submit"
          variant="contained"
          color={mode === 'replace' ? 'error' : 'primary'}
          disabled={busy}
        >
          {busy ? text.importing : text.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Settings › Backup (EXP-01): export the lists, favorites, history and settings to a JSON file
 * (secrets only with an export password), and import such a file after a preview.
 */
export function BackupSection() {
  const text = t.settings.backup;
  const inputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedBackup>();
  const [readError, setReadError] = useState<string>();

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReadError(undefined);
    try {
      setBackup(await readBackupFile(file));
    } catch (error) {
      if (error instanceof BackupFileError) {
        setReadError(text.readErrors[error.reason]);
      } else {
        log.warn('backup: the file could not be read', { error });
        setReadError(text.readError);
      }
    }
  };

  return (
    <SettingsSection title={t.settings.sections.backup}>
      <Stack spacing={3}>
        <Typography color="text.secondary">{text.intro}</Typography>
        <ExportForm />
        <Stack spacing={2}>
          <Typography variant="h3" component="h3" sx={{ typography: 'subtitle1' }}>
            {text.importTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {text.importHint}
          </Typography>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="backup-file-input"
            onChange={(event) => void onFile(event)}
          />
          <div>
            <Button variant="outlined" onClick={() => inputRef.current?.click()}>
              {text.choose}
            </Button>
          </div>
          <div role="status">{readError && <Alert severity="error">{readError}</Alert>}</div>
        </Stack>
      </Stack>
      {backup && <ImportDialog backup={backup} onClose={() => setBackup(undefined)} />}
    </SettingsSection>
  );
}
