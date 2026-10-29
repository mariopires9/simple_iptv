// Add-M3U-URL form (SRC-05): validation, Xtream `get.php` detection (→ Xtream form, prefilled in
// memory), then save (vault + source row) and import in the data worker with cancellable progress
// (bytes and entries). On failure the list can be imported again or deleted.
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Source, SourceStats } from '@/core/db';
import { log } from '@/core/log';
import { numberFormat, t } from '@/i18n';
import { detectXtreamPlaylistUrl, type SyncM3uResult } from '@/providers/m3u';
import { describeError, ProgressPanel, StateView, useToast } from '@/ui/state';
import type { TaskProgress } from '@/worker';
import { MAX_SOURCE_NAME_LENGTH } from '../xtream/saveXtreamSource';
import { stashXtreamPrefill } from '../xtream/prefill';
import { TextInput } from '../xtream/TextInput';
import {
  runM3uImport,
  settleM3uImport,
  type RunM3uImport,
  type SettleM3uImport,
} from './runM3uImport';
import { deleteM3uUrlSource, saveM3uUrlSource } from './saveM3uUrlSource';
import { validateM3uUrlForm, type M3uUrlFormValues } from './validate';

export interface M3uUrlFormDeps {
  saveSource: typeof saveM3uUrlSource;
  deleteSource: typeof deleteM3uUrlSource;
  runImport: RunM3uImport;
  /** After a cancel: waits for the worker to stop and returns the source row (real outcome). */
  settleImport: SettleM3uImport;
}

const defaultDeps: M3uUrlFormDeps = {
  saveSource: saveM3uUrlSource,
  deleteSource: deleteM3uUrlSource,
  runImport: runM3uImport,
  settleImport: settleM3uImport,
};

export interface M3uUrlFormProps {
  /** Where to go once the list is imported. */
  doneTo: string;
  /** The Xtream form to offer for `get.php` URLs. */
  xtreamTo: string;
  deps?: Partial<M3uUrlFormDeps>;
}

type Step = 'saving' | 'download' | 'write';
type FixCode = keyof typeof t.sources.fixes;

interface Failure {
  title: string;
  message: string;
  details?: string | undefined;
  fixes: FixCode[];
  /** Blocked by the browser: point to the local-file import (SRC-06, coming soon). */
  localFile: boolean;
  variant: 'error' | 'offline' | 'empty';
}

/** What the success panel shows. */
interface Imported {
  stats: SourceStats;
  skipped: number;
}

interface Progress {
  bytes: number;
  total?: number | undefined;
  entries: number;
  written: number;
  toWrite?: number | undefined;
}

const EMPTY: M3uUrlFormValues = { url: '', name: '' };
const NO_PROGRESS: Progress = { bytes: 0, entries: 0, written: 0 };

// Active locale at call time (a language switch applies at once, UX-06 AC5).
const integer = { format: (value: number) => numberFormat().format(value) };
const decimal = {
  format: (value: number) => numberFormat({ maximumFractionDigits: 1 }).format(value),
};

/** `512 KB`, `12.3 MB`. */
export function formatBytes(bytes: number): string {
  const units = t.sources.addM3uUrl.units;
  if (bytes < 1024 * 1024) return units.kb(integer.format(Math.ceil(bytes / 1024)));
  return units.mb(decimal.format(bytes / (1024 * 1024)));
}

function resultFailure(result: SyncM3uResult): Failure {
  const text = t.sources;
  const base = { fixes: [] as FixCode[], localFile: false, variant: 'error' as const };
  switch (result.error) {
    case 'blocked':
      if (result.hint === 'mixed-content') {
        return {
          ...base,
          ...text.problems['blocked-mixed-content'],
          fixes: ['use-https', 'use-local-file'],
          localFile: true,
        };
      }
      if (result.hint === 'cors') {
        return {
          ...base,
          ...text.problems['blocked-cors'],
          fixes: ['use-local-file', 'contact-provider'],
          localFile: true,
        };
      }
      // No hint: the connection broke after the server answered (not a CORS block).
      return {
        ...base,
        ...text.problems['network-error'],
        fixes: ['check-network', 'retry-later'],
      };
    case 'offline':
      return { ...base, ...text.problems.offline, fixes: ['check-network'], variant: 'offline' };
    case 'timeout':
      return { ...base, ...text.problems.timeout, fixes: ['retry-later'] };
    case 'http':
      return {
        ...base,
        title: text.problems['http-error'].title,
        message:
          result.httpStatus !== undefined
            ? t.state.errors.net.httpStatus(String(result.httpStatus))
            : text.problems['http-error'].message,
        fixes: ['check-server-url'],
      };
    case 'not-m3u':
    case 'empty-list':
    case 'too-large':
    case 'auth':
    case 'invalid-url':
    case 'credentials-lost':
    case 'storage':
      return { ...base, ...text.addM3uUrl.errors[result.error] };
    default:
      return { ...base, ...t.state.errors.unknown };
  }
}

function errorFailure(error: unknown): Failure {
  const d = describeError(error, t);
  return {
    title: d.title,
    message: d.message,
    details: d.details,
    fixes: [],
    localFile: false,
    variant: d.variant,
  };
}

export function M3uUrlForm({ doneTo, xtreamTo, deps: depsOverride }: M3uUrlFormProps) {
  const deps = { ...defaultDeps, ...depsOverride };
  const navigate = useNavigate();
  const toast = useToast();
  const text = t.sources.addM3uUrl;

  const [values, setValues] = useState<M3uUrlFormValues>(EMPTY);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [step, setStep] = useState<Step | undefined>();
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const [cancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>();
  /** The saved source while its first import has not succeeded (retry / delete). */
  const [source, setSource] = useState<Source | undefined>();
  const [success, setSuccess] = useState<Imported | undefined>();

  const urlInput = useRef<HTMLInputElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);

  // Leaving the screen does not cancel an import in flight: the source is saved and the worker
  // finishes it (its outcome is recorded on the source). Nothing is shown afterwards.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const xtream = useMemo(
    () => (source ? undefined : detectXtreamPlaylistUrl(values.url)),
    [values.url, source],
  );
  const busy = step !== undefined;
  const locked = busy || source !== undefined;

  const setField = (field: keyof M3uUrlFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'url' && urlError !== undefined) setUrlError(undefined);
  };

  function onProgress(p: TaskProgress) {
    if (!mounted.current) return;
    if (p.phase === 'download') {
      setProgress((c) => ({ ...c, bytes: p.done, total: p.total }));
    } else if (p.phase === 'parse') {
      setProgress((c) => ({ ...c, entries: p.done }));
    } else if (p.phase === 'write') {
      setStep('write');
      setProgress((c) => ({ ...c, written: p.done, toWrite: p.total }));
    }
  }

  async function runImport(target: Source) {
    const abort = new AbortController();
    controller.current = abort;
    setCancelling(false);
    setFailure(undefined);
    setProgress(NO_PROGRESS);
    setStep('download');
    let result: SyncM3uResult;
    try {
      result = await deps.runImport(target.id, { signal: abort.signal, onProgress });
    } catch (error) {
      if (abort.signal.aborted) {
        // The client-side cancel rejects at once; the worker may still be finishing a write phase
        // (not cancellable). Wait for it and report what really happened.
        const settled = await deps.settleImport(target.id).catch(() => undefined);
        if (controller.current === abort) controller.current = undefined;
        if (!mounted.current) return;
        setStep(undefined);
        if (settled?.lastSyncStatus === 'ok') {
          setSource(undefined);
          setSuccess({ stats: settled.stats, skipped: 0 });
        } else {
          setFailure(errorFailure(error));
        }
        return;
      }
      if (controller.current === abort) controller.current = undefined;
      if (!mounted.current) return;
      log.warn('M3U import failed', { sourceId: target.id, error });
      setStep(undefined);
      setFailure(errorFailure(error));
      return;
    }
    if (controller.current === abort) controller.current = undefined;
    if (!mounted.current) return;
    setStep(undefined);
    if (result.status === 'ok') {
      setSource(undefined);
      setSuccess({ stats: result.stats, skipped: result.skipped });
    } else {
      setFailure(resultFailure(result));
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const validation = validateM3uUrlForm(values);
    if (!validation.ok) {
      setUrlError(validation.error);
      setFailure(undefined);
      urlInput.current?.focus();
      return;
    }
    setUrlError(undefined);
    setFailure(undefined);
    setStep('saving');
    let saved: Source;
    try {
      saved = await deps.saveSource({
        name: values.name,
        host: validation.host,
        url: validation.url,
      });
    } catch (error) {
      log.warn('Saving the M3U source failed', { error });
      if (!mounted.current) return;
      setStep(undefined);
      setFailure(errorFailure(error));
      return;
    }
    if (!mounted.current) return;
    setSource(saved);
    await runImport(saved);
  }

  function cancel() {
    setCancelling(true);
    controller.current?.abort();
  }

  async function deleteList() {
    if (!source || busy) return;
    try {
      await deps.deleteSource(source);
    } catch (error) {
      log.warn('Deleting the M3U source failed', { error });
      if (mounted.current) setFailure(errorFailure(error));
      return;
    }
    if (!mounted.current) return;
    setSource(undefined);
    setFailure(undefined);
    toast.show({ message: text.toasts.deleted });
    urlInput.current?.focus();
  }

  function openXtreamForm() {
    if (!xtream) return;
    const state = stashXtreamPrefill({
      server: xtream.server,
      username: xtream.username,
      password: xtream.password,
      name: values.name,
    });
    void navigate(xtreamTo, { state });
  }

  function finish() {
    toast.show({ message: text.toasts.imported });
    void navigate(doneTo);
  }

  if (success) {
    const r = text.result;
    const lines = [
      r.live(integer.format(success.stats.live)),
      r.movies(integer.format(success.stats.movies)),
      r.series(integer.format(success.stats.series)),
    ];
    return (
      <Stack spacing={2} component="section" aria-labelledby="m3u-success-title">
        <Typography
          id="m3u-success-title"
          ref={successRef}
          tabIndex={-1}
          variant="h2"
          sx={{ outline: 'none' }}
        >
          {r.title}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {lines.map((line) => (
            <Typography component="li" key={line}>
              {line}
            </Typography>
          ))}
        </Box>
        {success.skipped > 0 && (
          <Typography color="text.secondary">
            {r.skipped(integer.format(success.skipped))}
          </Typography>
        )}
        <Button variant="contained" size="large" onClick={finish} sx={{ minHeight: 44 }}>
          {r.continue}
        </Button>
      </Stack>
    );
  }

  const progressLines: string[] = [];
  if (step === 'download' || step === 'write') {
    const p = text.progress;
    progressLines.push(
      progress.total !== undefined
        ? p.downloadedOf(formatBytes(progress.bytes), formatBytes(progress.total))
        : p.downloaded(formatBytes(progress.bytes)),
      p.entries(integer.format(progress.entries)),
    );
  }

  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <TextInput
          id="m3u-url"
          name="url"
          label={text.fields.url}
          value={values.url}
          onChange={setField('url')}
          error={urlError !== undefined}
          helperText={urlError ?? text.fields.urlHelp}
          disabled={locked}
          required
          autoComplete="off"
          inputRef={(el) => {
            urlInput.current = el;
          }}
          htmlInput={{
            inputMode: 'url',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
        <TextInput
          id="m3u-name"
          name="name"
          label={text.fields.name}
          value={values.name}
          onChange={setField('name')}
          helperText={text.fields.nameHelp}
          disabled={locked}
          autoComplete="off"
          htmlInput={{ maxLength: MAX_SOURCE_NAME_LENGTH }}
        />

        {xtream && !busy && (
          <Box
            data-testid="xtream-suggestion"
            sx={{
              display: 'flex',
              gap: 1.5,
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'info.main',
            }}
          >
            <InfoOutlined aria-hidden sx={{ color: 'info.main', mt: 0.25 }} />
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{text.xtreamSuggestion.title}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {text.xtreamSuggestion.message}
              </Typography>
              <Button variant="contained" onClick={openXtreamForm}>
                {text.xtreamSuggestion.action}
              </Button>
            </Box>
          </Box>
        )}

        {busy ? (
          <>
            <ProgressPanel
              phase={text.steps[step]}
              count={step === 'write' ? progress.written : undefined}
              total={step === 'write' ? progress.toWrite : undefined}
              onCancel={step === 'download' ? cancel : undefined}
              cancelling={cancelling}
            />
            {progressLines.length > 0 && (
              <Box data-testid="m3u-progress-details">
                {progressLines.map((line) => (
                  <Typography key={line} variant="body2" color="text.secondary">
                    {line}
                  </Typography>
                ))}
              </Box>
            )}
          </>
        ) : (
          source === undefined && (
            <Button type="submit" variant="contained" size="large" sx={{ minHeight: 44 }}>
              {text.submit}
            </Button>
          )
        )}

        {failure && !busy && (
          <Box ref={failureRef} tabIndex={-1} sx={{ outline: 'none' }} data-testid="m3u-failure">
            <StateView
              variant={failure.variant}
              title={failure.title}
              message={failure.message}
              details={failure.details}
              actions={
                source ? (
                  <>
                    <Button variant="contained" onClick={() => void runImport(source)}>
                      {text.retry}
                    </Button>
                    <Button variant="outlined" color="error" onClick={() => void deleteList()}>
                      {text.delete}
                    </Button>
                  </>
                ) : (
                  <Button type="submit" variant="contained">
                    {text.retry}
                  </Button>
                )
              }
            />
            {failure.fixes.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" component="h3">
                  {t.sources.fixesTitle}
                </Typography>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 3 }}>
                  {failure.fixes.map((fix) => (
                    <Typography component="li" variant="body2" key={fix}>
                      {t.sources.fixes[fix]}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
            {failure.localFile && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {text.localFileSoon}
              </Typography>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
