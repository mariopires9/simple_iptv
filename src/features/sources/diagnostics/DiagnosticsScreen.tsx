// Compatibility diagnostics of one list (SRC-09): a checklist (HTTPS, API access/CORS, live
// format, browser support, codecs), each failure with an explanation and what the user can do,
// and "Copy report" (masked). `/settings/sources/:sourceId/diagnostics`; the player's
// "Connection diagnostics" action uses `/settings/sources/diagnostics` (the active list).
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import RemoveCircleOutlineRounded from '@mui/icons-material/RemoveCircleOutlineRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { loadActiveSource } from '@/core/session';
import { t } from '@/i18n';
import { DelayedLoading, ProgressPanel, StateView, errorDetails, useToast } from '@/ui/state';
import { overallStatus, type CheckStatus, type DiagnosticAction } from './checks';
import { describeCheck, type DescribedCheck } from './describe';
import { buildReport } from './report';
import {
  runDiagnostics as defaultRun,
  type DiagnosticsDeps,
  type DiagnosticsResult,
} from './runDiagnostics';

const LISTS_PATH = '/settings/sources';

const STATUS_ICONS: Record<CheckStatus, typeof ErrorOutlineRounded> = {
  ok: CheckCircleOutlineRounded,
  warning: WarningAmberRounded,
  error: ErrorOutlineRounded,
  skipped: RemoveCircleOutlineRounded,
};

const STATUS_COLORS: Record<CheckStatus, string> = {
  ok: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
  skipped: 'text.secondary',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; source: Source };

export interface DiagnosticsScreenProps {
  /** Tests: fake environment for the checks. */
  deps?: Partial<DiagnosticsDeps>;
  /** Tests: clipboard. Default `navigator.clipboard.writeText`. */
  writeClipboard?: (text: string) => Promise<void>;
}

const defaultWriteClipboard = (text: string): Promise<void> => {
  const clipboard = (globalThis as { navigator?: { clipboard?: Clipboard } }).navigator?.clipboard;
  if (!clipboard) return Promise.reject(new Error('Clipboard unavailable'));
  return clipboard.writeText(text);
};

/** `/settings/sources/:sourceId/diagnostics`. */
export function DiagnosticsScreen({ deps, writeClipboard }: DiagnosticsScreenProps = {}) {
  const { sourceId = '' } = useParams();
  const text = t.diagnostics;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    sourcesRepo.get(sourceId).then(
      (source) => {
        if (current) setState(source ? { status: 'ready', source } : { status: 'missing' });
      },
      (error: unknown) => {
        if (current) setState({ status: 'error', error });
      },
    );
    return () => {
      current = false;
    };
  }, [sourceId, attempt]);

  let content;
  switch (state.status) {
    case 'loading':
      content = <DelayedLoading>{null}</DelayedLoading>;
      break;
    case 'missing':
      content = (
        <StateView
          variant="empty"
          title={text.notFound.title}
          message={text.notFound.message}
          actions={
            <Button variant="contained" component={Link} to={LISTS_PATH}>
              {t.sources.myLists.title}
            </Button>
          }
        />
      );
      break;
    case 'error':
      content = (
        <StateView
          variant="error"
          title={text.loadError.title}
          message={text.loadError.message}
          details={errorDetails(state.error)}
          actions={
            <Button
              variant="contained"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              {t.state.actions.retry}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      content = (
        <SourceDiagnostics
          source={state.source}
          deps={deps}
          writeClipboard={writeClipboard ?? defaultWriteClipboard}
        />
      );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <Button component={Link} to={LISTS_PATH} startIcon={<ArrowBack />} sx={{ mb: 1, ml: -1 }}>
        {text.back}
      </Button>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      {state.status === 'ready' && (
        <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {state.source.name} · {t.sources.myLists.kinds[state.source.kind]}
        </Typography>
      )}
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        {text.intro}
      </Typography>
      {content}
    </Box>
  );
}

type RunState =
  | { status: 'running' }
  | { status: 'done'; result: DiagnosticsResult }
  | { status: 'failed'; error: unknown };

function SourceDiagnostics({
  source,
  deps,
  writeClipboard,
}: {
  source: Source;
  deps: Partial<DiagnosticsDeps> | undefined;
  writeClipboard: (text: string) => Promise<void>;
}) {
  const text = t.diagnostics;
  const toast = useToast();
  const [run, setRun] = useState<RunState>({ status: 'running' });
  const [round, setRound] = useState(0);
  const [manualCopy, setManualCopy] = useState<string>();
  const reportId = useId();

  useEffect(() => {
    const controller = new AbortController();
    defaultRun(source, { signal: controller.signal, ...(deps ? { deps } : {}) }).then(
      (result) => {
        if (!controller.signal.aborted) setRun({ status: 'done', result });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        log.warn('Diagnostics failed', { error });
        setRun({ status: 'failed', error });
      },
    );
    return () => controller.abort();
  }, [source, deps, round]);

  const again = () => {
    setRun({ status: 'running' });
    setManualCopy(undefined);
    setRound((n) => n + 1);
  };

  if (run.status === 'running') return <ProgressPanel phase={text.running} />;
  if (run.status === 'failed') {
    return (
      <StateView
        variant="error"
        title={t.state.errors.unknown.title}
        message={t.state.errors.unknown.message}
        details={errorDetails(run.error)}
        actions={
          <Button variant="contained" onClick={again}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  }

  const { result } = run;
  const checks = result.checks.map((check) => describeCheck(check, text));

  const copy = async () => {
    const report = buildReport(result, {
      text,
      kindLabel: t.sources.myLists.kinds[source.kind],
      pageProtocol: (globalThis as { location?: { protocol?: string } }).location?.protocol,
      // The name defaults to the host (`sourceName`): masked when it looks like one.
      sensitive: [
        source.serverUrl,
        source.username,
        looksLikeHost(source.name) ? source.name : undefined,
      ],
    });
    try {
      await writeClipboard(report);
      setManualCopy(undefined);
      toast.show({ message: text.copied });
    } catch (error) {
      log.info('Diagnostics: clipboard unavailable, showing the report', { error });
      setManualCopy(report);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography role="status">{text.summary[overallStatus(result.checks)]}</Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {checks.map((check) => (
          <CheckItem key={check.id} check={check} source={source} />
        ))}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => void copy()}>
          {text.copy}
        </Button>
        <Button variant="outlined" onClick={again}>
          {text.runAgain}
        </Button>
      </Stack>
      {manualCopy !== undefined && (
        <Box>
          <Typography id={reportId} variant="body2" sx={{ mb: 1 }}>
            {text.copyFailed}
          </Typography>
          <Box
            component="textarea"
            readOnly
            aria-labelledby={reportId}
            value={manualCopy}
            rows={12}
            onFocus={(event) => (event.target as HTMLTextAreaElement).select()}
            sx={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: 13,
              p: 1,
              bgcolor: 'tokens.surface1',
              color: 'text.primary',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          />
        </Box>
      )}
    </Stack>
  );
}

const looksLikeHost = (name: string) => /^[^\s/]+\.[^\s/]+$/.test(name.trim());

/** Link offered next to an action, when the app has a place for it. */
function actionLink(
  code: DiagnosticAction,
  source: Source,
): { to: string; label: string } | undefined {
  const links = t.diagnostics.links;
  const edit = `/settings/sources/${encodeURIComponent(source.id)}/edit`;
  switch (code) {
    case 'use-https':
    case 'check-credentials':
      return source.kind === 'xtream' ? { to: edit, label: links.editList } : undefined;
    case 'local-file':
      return { to: LISTS_PATH, label: links.addList };
    case 'switch-live-format':
      return { to: '/settings', label: links.settings };
    default:
      return undefined;
  }
}

function CheckItem({ check, source }: { check: DescribedCheck; source: Source }) {
  const headingId = useId();
  const Icon = STATUS_ICONS[check.status];
  return (
    <Box
      component="li"
      aria-labelledby={headingId}
      data-testid={`check-${check.id}`}
      data-status={check.status}
      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Icon aria-hidden sx={{ color: STATUS_COLORS[check.status], mt: 0.25 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={headingId} variant="h3" component="h2">
            {check.title}
            <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
              {' — '}
              {check.statusLabel}
            </Box>
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {check.explanation}
          </Typography>
          {check.facts.map((fact) => (
            <Typography key={fact} variant="body2" color="text.secondary">
              {fact}
            </Typography>
          ))}
          {check.actions.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2" component="h3">
                {t.diagnostics.actionsTitle}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {check.actions.map((action) => {
                  const link = actionLink(action.code, source);
                  return (
                    <Box component="li" key={action.code} sx={{ mt: 0.5 }}>
                      <Typography variant="body2">{action.text}</Typography>
                      {link && (
                        <Button component={Link} to={link.to} size="small" sx={{ ml: -1 }}>
                          {link.label}
                        </Button>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** `/settings/sources/diagnostics`: the diagnostics of the active list (player error action). */
export function ActiveSourceDiagnosticsScreen() {
  const [target, setTarget] = useState<{ id: string | undefined } | undefined>();
  useEffect(() => {
    let current = true;
    loadActiveSource().then(
      (id) => {
        if (current) setTarget({ id });
      },
      (error: unknown) => {
        log.warn('Diagnostics: the active list could not be read', { error });
        if (current) setTarget({ id: undefined });
      },
    );
    return () => {
      current = false;
    };
  }, []);
  if (target === undefined) return <DelayedLoading>{null}</DelayedLoading>;
  const to =
    target.id !== undefined
      ? `/settings/sources/${encodeURIComponent(target.id)}/diagnostics`
      : LISTS_PATH;
  return <Navigate to={to} replace />;
}
