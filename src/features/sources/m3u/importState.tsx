// What the two M3U add forms share (SRC-05 by URL, SRC-06 from a file): running the import in the
// data worker with cancellable progress, reconciling a cancel with the real worker outcome, and
// turning outcomes into the failure / success / progress views.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, type Ref } from 'react';
import type { Source, SourceStats } from '@/core/db';
import { log } from '@/core/log';
import { intlNumberFormat, t } from '@/i18n';
import type { SyncM3uResult } from '@/providers/m3u';
import { formatBytes } from '@/ui/format';
import { describeError, ProgressPanel } from '@/ui/state';
import type { TaskProgress } from '@/worker';
import type { M3uImportOptions, SettleM3uImport } from './runM3uImport';

/** `download` (URL) or `read` (file) while the list is read and parsed. */
export type ImportStep = 'saving' | 'download' | 'read' | 'write';
export type FixCode = keyof typeof t.sources.fixes;

export interface ImportFailure {
  title: string;
  message: string;
  details?: string | undefined;
  fixes: FixCode[];
  /** Blocked by the browser: point to the local-file import (SRC-06). */
  localFile: boolean;
  variant: 'error' | 'offline' | 'empty';
}

/** What the success panel shows. */
export interface Imported {
  stats: SourceStats;
  skipped: number;
}

export interface ImportProgress {
  bytes: number;
  total?: number | undefined;
  entries: number;
  written: number;
  toWrite?: number | undefined;
}

const NO_PROGRESS: ImportProgress = { bytes: 0, entries: 0, written: 0 };

// Active locale at call time (a language switch applies at once, UX-06 AC5).
const integer = intlNumberFormat();

/** The failure shown for an import (of a URL, or of a local file) that resolved with an error code. */
export function resultFailure(result: SyncM3uResult, fromFile = false): ImportFailure {
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
    case 'file-unreadable':
      return { ...base, ...text.addM3uFile.errors['file-unreadable'] };
    case 'not-m3u':
      return { ...base, ...(fromFile ? text.addM3uFile : text.addM3uUrl).errors['not-m3u'] };
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

/** The failure shown for an exception (worker unavailable, cancelled, saving failed…). */
export function errorFailure(error: unknown): ImportFailure {
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

/**
 * State of an M3U import started from a form: the current step and progress, cancellation, and
 * the outcome (`failure` or `success`). Leaving the screen does not cancel an import in flight:
 * the source is saved and the worker finishes it (its outcome is recorded on the source); nothing
 * is shown afterwards.
 */
export function useM3uImport(settleImport: SettleM3uImport) {
  const [step, setStep] = useState<ImportStep | undefined>();
  const [progress, setProgress] = useState<ImportProgress>(NO_PROGRESS);
  const [cancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState<ImportFailure | undefined>();
  const [success, setSuccess] = useState<Imported | undefined>();
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function onProgress(p: TaskProgress) {
    if (!mounted.current) return;
    if (p.phase === 'download' || p.phase === 'read') {
      setProgress((c) => ({ ...c, bytes: p.done, total: p.total }));
    } else if (p.phase === 'parse') {
      setProgress((c) => ({ ...c, entries: p.done }));
    } else if (p.phase === 'write') {
      setStep('write');
      setProgress((c) => ({ ...c, written: p.done, toWrite: p.total }));
    }
  }

  /**
   * Runs `start` (the worker task) for `target`. Resolves `true` when the list was imported (or a
   * cancel came too late to stop the write), `false` otherwise or once the screen is gone.
   */
  async function run(
    target: Source,
    readStep: 'download' | 'read',
    start: (options: M3uImportOptions) => Promise<SyncM3uResult>,
  ): Promise<boolean> {
    const abort = new AbortController();
    controller.current = abort;
    setCancelling(false);
    setFailure(undefined);
    setProgress(NO_PROGRESS);
    setStep(readStep);
    let result: SyncM3uResult;
    try {
      result = await start({ signal: abort.signal, onProgress });
    } catch (error) {
      if (abort.signal.aborted) {
        // The client-side cancel rejects at once; the worker may still be finishing a write phase
        // (not cancellable). Wait for it and report what really happened.
        const settled = await settleImport(target.id).catch(() => undefined);
        if (controller.current === abort) controller.current = undefined;
        if (!mounted.current) return false;
        setStep(undefined);
        if (settled?.lastSyncStatus === 'ok') {
          setSuccess({ stats: settled.stats, skipped: 0 });
          return true;
        }
        setFailure(errorFailure(error));
        return false;
      }
      if (controller.current === abort) controller.current = undefined;
      if (!mounted.current) return false;
      log.warn('M3U import failed', { sourceId: target.id, error });
      setStep(undefined);
      setFailure(errorFailure(error));
      return false;
    }
    if (controller.current === abort) controller.current = undefined;
    if (!mounted.current) return false;
    setStep(undefined);
    if (result.status === 'ok') {
      setSuccess({ stats: result.stats, skipped: result.skipped });
      return true;
    }
    setFailure(resultFailure(result, readStep === 'read'));
    return false;
  }

  function cancel() {
    setCancelling(true);
    controller.current?.abort();
  }

  return {
    step,
    setStep,
    progress,
    cancelling,
    failure,
    setFailure,
    success,
    mounted,
    run,
    cancel,
  };
}

/** "List imported" with the counts, and the way on. */
export function ImportSuccess({
  success,
  onContinue,
  headingRef,
}: {
  success: Imported;
  onContinue: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const r = t.sources.addM3uUrl.result;
  const lines = [
    r.live(integer().format(success.stats.live)),
    r.movies(integer().format(success.stats.movies)),
    r.series(integer().format(success.stats.series)),
  ];
  return (
    <Stack spacing={2} component="section" aria-labelledby="m3u-success-title">
      <Typography
        id="m3u-success-title"
        ref={headingRef}
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
          {r.skipped(integer().format(success.skipped))}
        </Typography>
      )}
      <Button variant="contained" size="large" onClick={onContinue} sx={{ minHeight: 44 }}>
        {r.continue}
      </Button>
    </Stack>
  );
}

/** The running import: its step with cancel (while reading), then bytes and entries read. */
export function ImportProgressView({
  fromFile,
  step,
  progress,
  cancelling,
  onCancel,
}: {
  /** A local file (bytes "read") rather than a download. */
  fromFile: boolean;
  step: ImportStep;
  progress: ImportProgress;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const urlText = t.sources.addM3uUrl;
  const fileText = t.sources.addM3uFile;
  const phase = step === 'read' ? fileText.steps.read : urlText.steps[step];
  const lines: string[] = [];
  if (step !== 'saving') {
    const bytes = formatBytes(progress.bytes);
    const total = progress.total !== undefined ? formatBytes(progress.total) : undefined;
    if (fromFile && total !== undefined) lines.push(fileText.progress.readOf(bytes, total));
    else if (total !== undefined) lines.push(urlText.progress.downloadedOf(bytes, total));
    else lines.push(urlText.progress.downloaded(bytes));
    lines.push(urlText.progress.entries(integer().format(progress.entries)));
  }
  const reading = step === 'download' || step === 'read';
  return (
    <>
      <ProgressPanel
        phase={phase}
        count={step === 'write' ? progress.written : undefined}
        total={step === 'write' ? progress.toWrite : undefined}
        onCancel={reading ? onCancel : undefined}
        cancelling={cancelling}
      />
      {lines.length > 0 && (
        <Box data-testid="m3u-progress-details">
          {lines.map((line) => (
            <Typography key={line} variant="body2" color="text.secondary">
              {line}
            </Typography>
          ))}
        </Box>
      )}
    </>
  );
}

/** "What you can do" under a failure. */
export function FixesList({ fixes }: { fixes: readonly FixCode[] }) {
  if (fixes.length === 0) return null;
  return (
    <Box sx={{ mt: 1 }}>
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
