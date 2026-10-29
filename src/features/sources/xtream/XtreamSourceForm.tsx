// Add-Xtream form (SRC-03, docs/UX_UI.md §4.2): validation with focus on the first error, a
// cancelable connection test in visible steps, then saving (vault + source row) and the initial
// sync. The typed data stays in component state (memory only) until it is saved.
// Also edits a saved list (SRC-08 AC2): a rename is applied directly; a new server, username or
// password is tested first (with the stored password when none is typed) and only then applied.
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import type { FetchImpl } from '@/core/net';
import { intlDateTimeFormat, intlNumberFormat, t } from '@/i18n';
import {
  normalizeServerUrl,
  testConnection,
  type ConnectionAccount,
  type ConnectionFixCode,
  type ConnectionProblem,
  type ConnectionProblemCode,
  type XtreamConnectionReport,
} from '@/providers/xtream';
import { describeError, ProgressPanel, StateView, useToast } from '@/ui/state';
import { readXtreamPassword, sourceName, updateXtreamSource } from '../manage';
import { cancelSourceSync } from '../sourceSync';
import { startInitialSync, type InitialSyncDispatch, type StartInitialSync } from '../sync';
import { MAX_SOURCE_NAME_LENGTH, saveXtreamSource } from './saveXtreamSource';
import { TextInput } from './TextInput';
import {
  validateXtreamForm,
  XTREAM_FIELDS,
  type XtreamField,
  type XtreamFormErrors,
  type XtreamFormValues,
} from './validate';

export interface XtreamSourceFormDeps {
  testConnection: typeof testConnection;
  saveSource: typeof saveXtreamSource;
  startInitialSync: StartInitialSync;
  /** Edit mode: applies the changes to the saved list. */
  updateSource: typeof updateXtreamSource;
  /** Edit mode: the stored password, to re-test changed server/username without retyping it. */
  readPassword: typeof readXtreamPassword;
  /** Edit mode: stops a running sync of the list (it uses the old settings) and waits for it. */
  cancelSync: (sourceId: string) => Promise<void>;
}

const defaultDeps: XtreamSourceFormDeps = {
  testConnection,
  saveSource: saveXtreamSource,
  startInitialSync,
  updateSource: updateXtreamSource,
  readPassword: readXtreamPassword,
  cancelSync: cancelSourceSync,
};

export interface XtreamSourceFormProps {
  /** Where to go once the source is saved (Home from onboarding, My lists from Settings). */
  doneTo: string;
  /** Initial field values (e.g. converted from an M3U `get.php` URL, SRC-05 AC2). */
  initialValues?: Partial<XtreamFormValues> | undefined;
  /** Edit this saved Xtream list instead of adding one (SRC-08). */
  editing?: Source | undefined;
  /** Overrides for tests. */
  deps?: Partial<XtreamSourceFormDeps>;
}

type Step = 'contacting' | 'validating' | 'saving';

interface Failure {
  title: string;
  message: string;
  fixes: ConnectionFixCode[];
  details: string | undefined;
  /** Mixed-content block: the source may be saved anyway, marked as failing. */
  saveAnyway?: {
    serverUrl: string;
    host: string;
    problem: ConnectionProblemCode;
    /** The data that was tested (the fields may be edited afterwards). */
    values: XtreamFormValues;
  };
}

interface Success {
  source: Source;
  account: ConnectionAccount | undefined;
  warnings: ConnectionProblem[];
}

const EMPTY: XtreamFormValues = { name: '', server: '', username: '', password: '' };

const fixesOf = (problem: ConnectionProblem): ConnectionFixCode[] =>
  problem.fixes ?? (problem.fix !== undefined ? [problem.fix] : []);

function reportFailure(
  report: XtreamConnectionReport,
  host: string,
  values: XtreamFormValues,
): Failure {
  const problem = report.problems.find((p) => p.severity === 'error') ?? report.problems[0];
  const details = report.error ? describeError(report.error, t).details : undefined;
  if (problem === undefined) {
    const generic = t.state.errors.unknown;
    return { title: generic.title, message: generic.message, fixes: [], details };
  }
  const text = t.sources.problems[problem.code];
  const failure: Failure = {
    title: text.title,
    message: text.message,
    fixes: fixesOf(problem),
    details,
  };
  if (problem.code === 'blocked-mixed-content') {
    failure.saveAnyway = { serverUrl: report.baseUrl, host, problem: problem.code, values };
  }
  return failure;
}

function errorFailure(error: unknown): Failure {
  const description = describeError(error, t);
  return {
    title: description.title,
    message: description.message,
    fixes: [],
    details: description.details,
  };
}

/** Base URL of a saved list's server, normalized like the form's (to detect a change). */
function storedBaseUrl(source: Source): string | undefined {
  if (source.serverUrl === undefined) return undefined;
  const result = normalizeServerUrl(source.serverUrl);
  return result.ok ? result.baseUrl : undefined;
}

function editValues(source: Source): XtreamFormValues {
  return {
    name: source.name,
    server: source.serverUrl ?? '',
    username: source.username ?? '',
    // Never shown: empty keeps the stored password.
    password: '',
  };
}

export function XtreamSourceForm({
  doneTo,
  initialValues,
  editing,
  deps: depsOverride,
}: XtreamSourceFormProps) {
  const deps = { ...defaultDeps, ...depsOverride };
  const navigate = useNavigate();
  const toast = useToast();
  const text = t.sources;

  const [values, setValues] = useState<XtreamFormValues>(() =>
    editing ? editValues(editing) : { ...EMPTY, ...initialValues },
  );
  const [errors, setErrors] = useState<XtreamFormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<Step | undefined>();
  const [cancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>();
  const [success, setSuccess] = useState<Success | undefined>();

  const inputs = useRef<Partial<Record<XtreamField, HTMLInputElement | null>>>({});
  const controller = useRef<AbortController | undefined>(undefined);
  const failureRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  /** Resolves once the initial sync was dispatched (or could not be). */
  const syncDispatch = useRef<Promise<InitialSyncDispatch> | undefined>(undefined);
  const mounted = useRef(true);

  // Leaving the screen cancels a test in flight; a save in flight completes, but without any
  // toast or navigation afterwards.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const setField = (field: XtreamField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] !== undefined) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save(
    input: { serverUrl: string; host: string; values: XtreamFormValues },
    outcome: { report: XtreamConnectionReport } | { problem: ConnectionProblemCode },
  ) {
    setStep('saving');
    try {
      const failed = 'problem' in outcome;
      const source = await deps.saveSource({
        name: input.values.name,
        host: input.host,
        serverUrl: input.serverUrl,
        username: input.values.username.trim(),
        password: input.values.password,
        lastSyncStatus: failed ? 'error' : 'never',
        ...(failed ? { lastSyncError: outcome.problem } : {}),
      });
      if (!failed) {
        // Not awaited here: saving does not depend on the sync (SRC-07 reports its own state).
        // Started even if the screen was left meanwhile: the source is saved.
        syncDispatch.current = deps
          .startInitialSync(source.id)
          .catch((): InitialSyncDispatch => 'unavailable');
      }
      if (!mounted.current) return;
      setStep(undefined);
      if (failed) {
        toast.show({ message: text.toasts.savedWithError });
        void navigate(doneTo);
        return;
      }
      setSuccess({
        source,
        account: outcome.report.account,
        warnings: outcome.report.problems.filter((p) => p.severity === 'warning'),
      });
    } catch (error) {
      log.warn('Saving the Xtream source failed', { error });
      if (!mounted.current) return;
      setStep(undefined);
      setFailure(errorFailure(error));
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (step !== undefined) return;
    const validation = validateXtreamForm(values, { passwordOptional: editing !== undefined });
    if (!validation.ok) {
      setErrors(validation.errors);
      setFailure(undefined);
      inputs.current[validation.firstInvalid]?.focus();
      return;
    }
    setErrors({});
    setFailure(undefined);
    let tested = values;

    if (editing) {
      const username = values.username.trim();
      const unchanged =
        values.password === '' &&
        username === (editing.username ?? '') &&
        validation.baseUrl === storedBaseUrl(editing);
      if (unchanged) {
        // A rename (or nothing): no connection test needed.
        await applyEdit(editing, {
          name: sourceName(values.name, validation.host),
          serverUrl: editing.serverUrl ?? validation.baseUrl,
          username,
          resync: false,
        });
        return;
      }
      if (values.password === '') {
        // Re-test with the stored password, read into memory only for the test.
        const stored = await deps.readPassword(editing.id).catch((error: unknown) => {
          log.warn('Reading the stored password failed', { error });
          return undefined;
        });
        if (stored === undefined) {
          setErrors({ password: text.edit.passwordLost });
          inputs.current.password?.focus();
          return;
        }
        tested = { ...values, password: stored };
      }
    }

    const abort = new AbortController();
    controller.current = abort;
    setCancelling(false);
    setStep('contacting');
    // The first answer from the server moves the visible step to "Validating account".
    const fetchImpl: FetchImpl = async (input, init) => {
      const response = await fetch(input, init);
      if (!abort.signal.aborted) setStep((s) => (s === 'contacting' ? 'validating' : s));
      return response;
    };

    let report: XtreamConnectionReport;
    try {
      report = await deps.testConnection({
        baseUrl: validation.baseUrl,
        username: tested.username.trim(),
        password: tested.password,
        signal: abort.signal,
        fetchImpl,
      });
    } catch (error) {
      setStep(undefined);
      setCancelling(false);
      // Cancelled by the user (or by leaving the screen): back to the form, nothing to report.
      if (!abort.signal.aborted) setFailure(errorFailure(error));
      return;
    } finally {
      if (controller.current === abort) controller.current = undefined;
    }
    if (abort.signal.aborted) {
      setStep(undefined);
      setCancelling(false);
      return;
    }

    if (report.ok) {
      if (editing) {
        await applyEdit(editing, {
          name: sourceName(tested.name, validation.host),
          serverUrl: report.baseUrl,
          username: tested.username.trim(),
          password: values.password === '' ? undefined : values.password,
          resync: true,
        });
        return;
      }
      await save({ serverUrl: report.baseUrl, host: validation.host, values: tested }, { report });
    } else {
      setStep(undefined);
      const failure = reportFailure(report, validation.host, tested);
      // A saved list keeps its working settings: an edit is only applied after a passing test.
      if (editing) delete failure.saveAnyway;
      setFailure(failure);
    }
  }

  async function applyEdit(
    source: Source,
    change: {
      name: string;
      serverUrl: string;
      username: string;
      password?: string | undefined;
      resync: boolean;
    },
  ) {
    setStep('saving');
    try {
      // A sync still running with the old server/account would overwrite the catalogue after
      // ours: stop it first, then apply, then sync again with the new settings.
      if (change.resync) await deps.cancelSync(source.id);
      await deps.updateSource({
        id: source.id,
        name: change.name,
        serverUrl: change.serverUrl,
        username: change.username,
        password: change.password,
      });
      // New server or account: reload the catalogue (not awaited beyond the dispatch). Only
      // "started" claims that channels are loading.
      const dispatch = change.resync
        ? await deps.startInitialSync(source.id).catch((): InitialSyncDispatch => 'unavailable')
        : undefined;
      if (!mounted.current) return;
      setStep(undefined);
      toast.show({
        message: dispatch === 'started' ? text.toasts.syncing : text.myLists.toasts.updated,
      });
      void navigate(doneTo);
    } catch (error) {
      log.warn('Updating the Xtream source failed', { error });
      if (!mounted.current) return;
      setStep(undefined);
      setFailure(errorFailure(error));
    }
  }

  function cancelTest() {
    setCancelling(true);
    controller.current?.abort();
  }

  function saveAnyway() {
    const target = failure?.saveAnyway;
    if (!target || step !== undefined) return;
    setFailure(undefined);
    void save(target, { problem: target.problem });
  }

  async function finish() {
    // Only claim "loading" when the sync task was actually dispatched.
    const dispatch = await syncDispatch.current;
    if (!mounted.current) return;
    toast.show({ message: dispatch === 'started' ? text.toasts.syncing : text.toasts.saved });
    void navigate(doneTo);
  }

  if (success) {
    return <SuccessPanel success={success} headingRef={successRef} onDone={() => void finish()} />;
  }

  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        {XTREAM_FIELDS.map((field) => {
          const error = errors[field];
          const common = {
            id: `xtream-${field}`,
            name: field,
            label: text.fields[field],
            value: values[field],
            onChange: setField(field),
            error: error !== undefined,
            disabled: step !== undefined,
            required: field !== 'name' && !(editing && field === 'password'),
            inputRef: (el: HTMLInputElement | null) => {
              inputs.current[field] = el;
            },
          };
          switch (field) {
            case 'name':
              return (
                <TextInput
                  key={field}
                  {...common}
                  helperText={error ?? text.fields.nameHelp}
                  autoComplete="off"
                  htmlInput={{ maxLength: MAX_SOURCE_NAME_LENGTH }}
                />
              );
            case 'server':
              return (
                <TextInput
                  key={field}
                  {...common}
                  helperText={error ?? text.fields.serverHelp}
                  autoComplete="url"
                  htmlInput={{
                    inputMode: 'url',
                    autoCapitalize: 'off',
                    autoCorrect: 'off',
                    spellCheck: false,
                  }}
                />
              );
            case 'username':
              return (
                <TextInput
                  key={field}
                  {...common}
                  helperText={error}
                  autoComplete="username"
                  htmlInput={{ autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false }}
                />
              );
            case 'password':
              return (
                <TextInput
                  key={field}
                  {...common}
                  helperText={error ?? (editing ? text.edit.passwordKeepHelp : undefined)}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  htmlInput={{ autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false }}
                  endAdornment={
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={text.fields.showPassword}
                        aria-pressed={showPassword}
                        aria-controls="xtream-password"
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={step !== undefined}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  }
                />
              );
          }
        })}

        {step !== undefined ? (
          <ProgressPanel
            phase={text.steps[step]}
            onCancel={step === 'saving' ? undefined : cancelTest}
            cancelling={cancelling}
          />
        ) : (
          <Button type="submit" variant="contained" size="large" sx={{ minHeight: 44 }}>
            {editing ? text.edit.save : text.submit}
          </Button>
        )}

        {failure && step === undefined && (
          <Box ref={failureRef} tabIndex={-1} sx={{ outline: 'none' }} data-testid="xtream-failure">
            <StateView
              variant="error"
              title={failure.title}
              message={failure.message}
              details={failure.details}
              actions={
                <>
                  <Button type="submit" variant="contained">
                    {t.state.actions.retry}
                  </Button>
                  {failure.saveAnyway && (
                    <Button variant="outlined" onClick={saveAnyway}>
                      {text.saveAnyway}
                    </Button>
                  )}
                </>
              }
            />
            <FixList fixes={failure.fixes} />
            {failure.saveAnyway && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {text.saveAnywayHint}
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}

function FixList({ fixes }: { fixes: readonly ConnectionFixCode[] }) {
  if (fixes.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        {t.sources.fixesTitle}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 3 }}>
        {fixes.map((fix) => (
          <Typography component="li" variant="body2" key={fix}>
            {t.sources.fixes[fix]}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

// Active locale at call time (a language switch applies at once, UX-06 AC5).
const longDate = intlDateTimeFormat({ dateStyle: 'long' });
const integer = intlNumberFormat();

/** Account lines shown after a successful test (status, expiry, connections). */
export function accountLines(account: ConnectionAccount | undefined): string[] {
  if (!account) return [];
  const r = t.sources.result;
  const lines = [r.status(account.status)];
  lines.push(
    account.expiresAt !== undefined ? r.expires(longDate().format(account.expiresAt)) : r.noExpiry,
  );
  const { activeConnections: active, maxConnections: max } = account;
  if (max !== undefined && max > 0) {
    lines.push(
      active !== undefined
        ? r.connections(integer().format(active), integer().format(max))
        : r.maxConnections(integer().format(max)),
    );
  }
  return lines;
}

function SuccessPanel({
  success,
  headingRef,
  onDone,
}: {
  success: Success;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
}) {
  const r = t.sources.result;
  return (
    <Stack spacing={2} component="section" aria-labelledby="xtream-success-title">
      <Typography
        id="xtream-success-title"
        ref={headingRef}
        tabIndex={-1}
        variant="h2"
        sx={{ outline: 'none' }}
      >
        {r.title}
      </Typography>
      <Typography sx={{ fontWeight: 600 }}>{success.source.name}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {accountLines(success.account).map((line) => (
          <Typography component="li" key={line}>
            {line}
          </Typography>
        ))}
      </Box>
      {success.warnings.length > 0 && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" component="h3">
            {r.warningsTitle}
          </Typography>
          {success.warnings.map((warning) => (
            // Not a live region: focus moves to the heading and the warnings follow it.
            <Box
              key={warning.code}
              data-testid={`warning-${warning.code}`}
              sx={{
                display: 'flex',
                gap: 1.5,
                p: 2,
                borderRadius: 2,
                border: 1,
                borderColor: 'warning.main',
              }}
            >
              <WarningAmberRounded aria-hidden sx={{ color: 'warning.main', mt: 0.25 }} />
              <Box>
                <Typography sx={{ fontWeight: 600 }}>
                  {t.sources.problems[warning.code].title}
                </Typography>
                <Typography variant="body2">{t.sources.problems[warning.code].message}</Typography>
                <FixList fixes={fixesOf(warning)} />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
      <Button variant="contained" size="large" onClick={onDone} sx={{ minHeight: 44 }}>
        {r.continue}
      </Button>
    </Stack>
  );
}
