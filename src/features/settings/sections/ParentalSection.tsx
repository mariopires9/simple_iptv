import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ContentType } from '@/core/db';
import { log } from '@/core/log';
import {
  isValidPin,
  lockParental,
  PIN_MAX_LENGTH,
  removeParentalPin,
  setParentalPin,
  WrongPinError,
} from '@/core/session/parental';
import { t } from '@/i18n';
import { PinDialog, useParental } from '@/ui/parental';
import { useToast } from '@/ui/state';
import {
  loadParentalCategories,
  PARENTAL_TYPES,
  saveRestrictedCategories,
  type CategoryChoice,
  type ParentalCategories,
} from '../parentalSettings';
import { SettingsSection } from '../SettingsSection';

type PinMode = 'set' | 'change' | 'remove';

const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);

function PinField({
  label,
  value,
  onChange,
  error,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  helper?: string | undefined;
}) {
  return (
    <TextField
      fullWidth
      margin="dense"
      type="password"
      label={label}
      value={value}
      onChange={(event) => onChange(digitsOnly(event.target.value))}
      error={error}
      helperText={helper}
      autoComplete="off"
      slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: PIN_MAX_LENGTH } }}
    />
  );
}

/** Set, change or remove the PIN; change and remove need the current PIN (SEC-03). */
function PinFormDialog({ mode, onClose }: { mode: PinMode; onClose: () => void }) {
  const text = t.parental.settings;
  const toast = useToast();
  const titleId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ field: 'current' | 'next' | 'confirm'; text: string }>();
  const [busy, setBusy] = useState(false);
  const needsCurrent = mode !== 'set';
  const needsNew = mode !== 'remove';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (needsNew && !isValidPin(next)) return setError({ field: 'next', text: text.invalidPin });
    if (needsNew && next !== confirm) return setError({ field: 'confirm', text: text.mismatch });
    setBusy(true);
    try {
      if (mode === 'remove') await removeParentalPin(current);
      else await setParentalPin(next, needsCurrent ? current : undefined);
      toast.show({
        message: mode === 'remove' ? text.pinRemoved : text.pinSaved,
        severity: 'success',
      });
      onClose();
    } catch (failure) {
      if (failure instanceof WrongPinError) {
        setCurrent('');
        setError({ field: 'current', text: text.wrongPin });
      } else {
        log.warn('settings: the parental PIN could not be saved', {
          error: failure instanceof Error ? failure.name : 'unknown',
        });
        toast.show({ message: text.saveError, severity: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'set' ? text.setPin : mode === 'change' ? text.changePin : text.removeTitle;
  const helperOf = (field: 'current' | 'next' | 'confirm', fallback?: string) =>
    error?.field === field ? error.text : fallback;
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent>
          {mode === 'remove' && <DialogContentText>{text.removeMessage}</DialogContentText>}
          {needsCurrent && (
            <PinField
              label={text.currentPin}
              value={current}
              onChange={setCurrent}
              error={error?.field === 'current'}
              helper={helperOf('current')}
            />
          )}
          {needsNew && (
            <>
              <PinField
                label={text.newPin}
                value={next}
                onChange={setNext}
                error={error?.field === 'next'}
                helper={helperOf('next', text.newPinHint)}
              />
              <PinField
                label={text.confirmPin}
                value={confirm}
                onChange={setConfirm}
                error={error?.field === 'confirm'}
                helper={helperOf('confirm')}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{text.cancel}</Button>
          <Button
            type="submit"
            variant="contained"
            color={mode === 'remove' ? 'error' : 'primary'}
            disabled={busy}
          >
            {mode === 'remove' ? text.removePin : text.save}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Checklist of one type's categories of the active list. */
function CategoryPicker({
  type,
  choices,
  sourceId,
  initial,
  onClose,
}: {
  type: ContentType;
  choices: readonly CategoryChoice[];
  sourceId: string;
  initial: ReadonlySet<string>;
  onClose: () => void;
}) {
  const text = t.parental.settings;
  const toast = useToast();
  const titleId = useId();
  const [selected, setSelected] = useState(() => new Set(initial));
  const [busy, setBusy] = useState(false);
  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const save = async () => {
    setBusy(true);
    try {
      await saveRestrictedCategories(sourceId, type, [...selected]);
      toast.show({ message: text.categoriesSaved, severity: 'success' });
      onClose();
    } catch (failure) {
      log.warn('settings: the restricted categories could not be saved', {
        error: failure instanceof Error ? failure.name : 'unknown',
      });
      toast.show({ message: text.saveError, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle id={titleId}>{text.pickerTitle(text.types[type])}</DialogTitle>
      <DialogContent dividers>
        {choices.length === 0 ? (
          <DialogContentText>{text.pickerEmpty}</DialogContentText>
        ) : (
          <FormGroup>
            {choices.map((choice) => (
              <FormControlLabel
                key={choice.key}
                control={
                  <Checkbox
                    checked={selected.has(choice.key)}
                    onChange={(event) => toggle(choice.key, event.target.checked)}
                  />
                }
                label={choice.uncategorized ? text.uncategorized : choice.name}
              />
            ))}
          </FormGroup>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{text.cancel}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy}>
          {text.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The restricted categories of the active list (shown while unlocked). */
function RestrictedCategories({ restricted }: { restricted: ReadonlySet<string> }) {
  const text = t.parental.settings;
  const [data, setData] = useState<ParentalCategories | null>();
  const [picking, setPicking] = useState<ContentType>();
  useEffect(() => {
    let active = true;
    loadParentalCategories().then(
      (next) => {
        if (active) setData(next ?? null);
      },
      (error: unknown) => {
        log.warn('settings: the categories could not be read', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        if (active) setData(null);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (data === undefined) return null;
  if (data === null) return <Typography color="text.secondary">{text.categoriesNoList}</Typography>;
  const restrictedOf = (type: ContentType) =>
    new Set(data.byType[type].filter((c) => restricted.has(c.key)).map((c) => c.key));
  return (
    <Stack spacing={1}>
      <Typography variant="h3" component="h3">
        {text.categories}
      </Typography>
      <Typography color="text.secondary">{text.categoriesHint(data.sourceName)}</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {PARENTAL_TYPES.map((type) => (
          <Button key={type} variant="outlined" onClick={() => setPicking(type)}>
            {text.choose(text.types[type], restrictedOf(type).size)}
          </Button>
        ))}
      </Stack>
      {picking && (
        <CategoryPicker
          type={picking}
          choices={data.byType[picking]}
          sourceId={data.sourceId}
          initial={restrictedOf(picking)}
          onClose={() => setPicking(undefined)}
        />
      )}
    </Stack>
  );
}

/**
 * Settings › Parental control (SEC-03): a 4–8 digit PIN (stored as a salted hash) and the
 * restricted categories of the active list. Change/remove need the current PIN; a forgotten PIN
 * is only removed by deleting all data. States plainly that it is a deterrent.
 */
export function ParentalSection() {
  const text = t.parental.settings;
  const parental = useParental();
  const [pinMode, setPinMode] = useState<PinMode>();
  const [unlocking, setUnlocking] = useState(false);

  let status = text.statusOff;
  if (parental.pinSet) status = parental.unlocked ? text.statusUnlocked : text.statusLocked;

  return (
    <SettingsSection title={text.title}>
      <Stack spacing={2}>
        <Typography>{text.intro}</Typography>
        <Alert severity="warning">{text.deterrent}</Alert>
        {parental.known && (
          <>
            <Typography role="status">{status}</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {!parental.pinSet && (
                <Button variant="contained" onClick={() => setPinMode('set')}>
                  {text.setPin}
                </Button>
              )}
              {parental.pinSet && !parental.unlocked && (
                <Button variant="contained" onClick={() => setUnlocking(true)}>
                  {text.unlock}
                </Button>
              )}
              {parental.pinSet && parental.unlocked && (
                <Button variant="contained" onClick={lockParental}>
                  {text.lockNow}
                </Button>
              )}
              {parental.pinSet && (
                <>
                  <Button onClick={() => setPinMode('change')}>{text.changePin}</Button>
                  <Button color="error" onClick={() => setPinMode('remove')}>
                    {text.removePin}
                  </Button>
                </>
              )}
            </Stack>
            {parental.pinSet && parental.unlocked && (
              <RestrictedCategories restricted={parental.restricted} />
            )}
            {parental.pinSet && !parental.unlocked && (
              <Typography color="text.secondary">{text.categoriesLocked}</Typography>
            )}
            {parental.pinSet && (
              <Typography color="text.secondary">
                {text.forgot} <Link to="/settings/privacy">{text.forgotLink}</Link>
              </Typography>
            )}
          </>
        )}
      </Stack>
      {pinMode && <PinFormDialog mode={pinMode} onClose={() => setPinMode(undefined)} />}
      <PinDialog open={unlocking} onClose={() => setUnlocking(false)} />
    </SettingsSection>
  );
}
