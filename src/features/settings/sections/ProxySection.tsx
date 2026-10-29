import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { ProxyRouting } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { formatInteger } from '@/ui/catalog/format';
import { useToast } from '@/ui/state';
import {
  loadProxySettings,
  PROXY_ROUTINGS,
  removeProxy,
  resolveProxyForm,
  saveListRouting,
  saveProxy,
  testProxy,
  type ProxyFormProblems,
  type ProxySettings,
  type ProxyTestOutcome,
} from '../proxySettings';
import { SettingsSection } from '../SettingsSection';

function Field({
  id,
  label,
  value,
  onChange,
  helper,
  error,
  type = 'text',
  autoComplete,
  endAdornment,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper: string;
  error: boolean;
  type?: string;
  autoComplete: string;
  endAdornment?: ReactNode;
}) {
  const helperId = `${id}-helper`;
  return (
    <FormControl fullWidth error={error}>
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <OutlinedInput
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        inputProps={{
          'aria-describedby': helperId,
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
        }}
        endAdornment={endAdornment}
      />
      <FormHelperText id={helperId}>{helper}</FormHelperText>
    </FormControl>
  );
}

function outcomeAlert(outcome: ProxyTestOutcome): { severity: 'success' | 'error'; text: string } {
  const text = t.settings.proxy.outcomes;
  switch (outcome.kind) {
    case 'ok': {
      const streams = formatInteger(outcome.activeUpstreams);
      return {
        severity: 'success',
        text:
          outcome.listName !== undefined
            ? text.okList(outcome.listName, streams)
            : text.ok(streams),
      };
    }
    case 'not-allowed':
      return { severity: 'error', text: text.notAllowed(outcome.listName) };
    case 'auth':
      return { severity: 'error', text: text.auth };
    case 'unreachable':
      return { severity: 'error', text: text.unreachable };
    case 'not-proxy':
      return { severity: 'error', text: text.notProxy };
  }
}

/**
 * Settings › Personal proxy (PRX-01, ADR-010): the proxy's address and token (Save / Test
 * connection / Remove) and, once one is saved, each list's routing (Off by default). The token is
 * never shown back: an empty token field keeps the saved one.
 */
export function ProxySection() {
  const text = t.settings.proxy;
  const toast = useToast();
  const urlId = useId();
  const tokenId = useId();
  const routingHintId = useId();
  const [settings, setSettings] = useState<ProxySettings>();
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [problems, setProblems] = useState<ProxyFormProblems>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'remove'>();
  const [outcome, setOutcome] = useState<ProxyTestOutcome>();

  useEffect(() => {
    let active = true;
    loadProxySettings().then(
      (loaded) => {
        if (!active) return;
        setSettings(loaded);
        setBaseUrl(loaded.savedBaseUrl ?? '');
      },
      (error: unknown) => log.warn('settings: the proxy settings could not be read', { error }),
    );
    return () => {
      active = false;
    };
  }, []);

  if (!settings) return <SettingsSection title={t.settings.sections.proxy}>{null}</SettingsSection>;

  const saved = settings.savedBaseUrl !== undefined;

  /** Validates the form; shows the problems and returns `undefined` when it is not valid. */
  const validate = async () => {
    const result = await resolveProxyForm(baseUrl, token);
    setProblems(result.ok ? {} : result.problems);
    return result.ok ? result.config : undefined;
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('save');
    try {
      const config = await validate();
      if (!config) return;
      await saveProxy(config);
      setSettings((current) => current && { ...current, savedBaseUrl: config.baseUrl });
      setBaseUrl(config.baseUrl);
      setToken('');
      toast.show({ message: text.saved, severity: 'success' });
    } catch (error) {
      log.warn('settings: the proxy could not be saved', { error });
      toast.show({ message: text.saveError, severity: 'error' });
    } finally {
      setBusy(undefined);
    }
  };

  const onTest = async () => {
    if (busy) return;
    setBusy('test');
    setOutcome(undefined);
    try {
      const config = await validate();
      if (!config) return;
      setOutcome(await testProxy(config));
    } catch (error) {
      log.warn('settings: the proxy test failed', { error });
      toast.show({ message: text.testError, severity: 'error' });
    } finally {
      setBusy(undefined);
    }
  };

  const onRemove = async () => {
    if (busy) return;
    setBusy('remove');
    try {
      await removeProxy();
      setSettings(
        (current) =>
          current && {
            savedBaseUrl: undefined,
            lists: current.lists.map((list) => ({ ...list, routing: 'off' })),
          },
      );
      setBaseUrl('');
      setToken('');
      setProblems({});
      setOutcome(undefined);
      toast.show({ message: text.removed, severity: 'success' });
    } catch (error) {
      log.warn('settings: the proxy could not be removed', { error });
      toast.show({ message: text.removeError, severity: 'error' });
    } finally {
      setBusy(undefined);
    }
  };

  /** Optimistic; a failed save puts the list's previous routing back (if still shown). */
  const changeRouting = (id: string, routing: ProxyRouting) => {
    const previous = settings.lists.find((list) => list.id === id)?.routing;
    const setRouting = (value: ProxyRouting, onlyIf?: ProxyRouting) =>
      setSettings(
        (current) =>
          current && {
            ...current,
            lists: current.lists.map((list) =>
              list.id === id && (onlyIf === undefined || list.routing === onlyIf)
                ? { ...list, routing: value }
                : list,
            ),
          },
      );
    setRouting(routing);
    saveListRouting(id, routing).catch((error: unknown) => {
      log.warn('settings: a list routing could not be saved', { error });
      if (previous !== undefined) setRouting(previous, routing);
      toast.show({ message: text.routing.saveError, severity: 'error' });
    });
  };

  const urlProblem = problems.baseUrl;
  const tokenProblem = problems.token;
  const alert = outcome && outcomeAlert(outcome);

  return (
    <SettingsSection title={t.settings.sections.proxy}>
      <Stack spacing={2}>
        <Typography color="text.secondary">{text.intro}</Typography>
        <Stack component="form" spacing={2} noValidate onSubmit={(e) => void onSave(e)}>
          <Field
            id={urlId}
            label={text.url}
            value={baseUrl}
            onChange={setBaseUrl}
            helper={urlProblem ? text.errors.baseUrl[urlProblem] : text.urlHint}
            error={urlProblem !== undefined}
            type="url"
            autoComplete="url"
          />
          <Field
            id={tokenId}
            label={text.token}
            value={token}
            onChange={setToken}
            helper={
              tokenProblem
                ? text.errors.token[tokenProblem]
                : saved
                  ? text.tokenKeep
                  : text.tokenHint
            }
            error={tokenProblem !== undefined}
            type={showToken ? 'text' : 'password'}
            autoComplete="off"
            endAdornment={
              <InputAdornment position="end">
                <IconButton
                  aria-label={text.showToken}
                  aria-pressed={showToken}
                  aria-controls={tokenId}
                  onClick={() => setShowToken((v) => !v)}
                  edge="end"
                >
                  {showToken ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            }
          />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button type="submit" variant="contained" disabled={busy !== undefined}>
              {text.save}
            </Button>
            <Button variant="outlined" disabled={busy !== undefined} onClick={() => void onTest()}>
              {busy === 'test' ? text.testing : text.test}
            </Button>
            {saved && (
              <Button color="error" disabled={busy !== undefined} onClick={() => void onRemove()}>
                {text.remove}
              </Button>
            )}
          </Stack>
        </Stack>
        <div data-testid="proxy-test-result">
          {alert && <Alert severity={alert.severity}>{alert.text}</Alert>}
        </div>
        <Typography variant="h3" component="h3" sx={{ typography: 'subtitle1' }}>
          {text.routing.title}
        </Typography>
        <Typography id={routingHintId} variant="body2" color="text.secondary">
          {saved ? text.routing.hint : text.routing.disabledHint}
        </Typography>
        {settings.lists.length === 0 ? (
          <Typography variant="body2">{text.routing.noLists}</Typography>
        ) : (
          settings.lists.map((list) => (
            <TextField
              key={list.id}
              select
              size="small"
              label={text.routing.label(list.name)}
              value={list.routing}
              disabled={!saved}
              onChange={(event) => changeRouting(list.id, event.target.value as ProxyRouting)}
              sx={{ maxWidth: 360 }}
              slotProps={{
                select: { native: true },
                htmlInput: { 'aria-describedby': routingHintId },
              }}
            >
              {PROXY_ROUTINGS.map((routing) => (
                <option key={routing} value={routing}>
                  {text.routing.options[routing]}
                </option>
              ))}
            </TextField>
          ))
        )}
      </Stack>
    </SettingsSection>
  );
}
