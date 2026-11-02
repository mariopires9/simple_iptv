import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import {
  getCapabilities,
  getStorageStatus,
  isInstalledApp,
  requestPersistentStorage,
  type StorageStatus,
} from '@/core/platform';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { formatBytes } from '@/ui/format';
import { SettingsSection } from '../SettingsSection';
import { backupRestart } from '../backup/importBackup';
import { clearCachedData, type ClearResult, type ClearSelection } from '../storage/clearCachedData';
import { ClearCachedDataDialog } from '../storage/ClearCachedDataDialog';
import { StorageBreakdownView, type BreakdownState } from '../storage/StorageBreakdownView';
import { loadStorageBreakdown, type StorageBreakdown } from '../storage/storageUsage';

/** Injectable platform checks (tests). */
export interface StorageSectionProps {
  loadStatus?: () => Promise<StorageStatus>;
  requestPersist?: () => Promise<boolean | undefined>;
  /** iOS/iPadOS (any browser there is Safari's WebKit). */
  isIOS?: () => boolean;
  isInstalled?: () => boolean;
  /** STO-01: the breakdown estimate, the clear, and the restart after a catalogue clear. */
  loadBreakdown?: (signal: AbortSignal) => Promise<StorageBreakdown>;
  clear?: (selection: ClearSelection) => Promise<ClearResult>;
  restart?: () => void;
}

/**
 * Settings › Storage (PWA-05): whether the browser keeps the data (`persisted()`), a way to ask
 * again, the space used (`estimate()`), and on iOS outside the installed app the 7-day warning.
 * STO-01: what is stored (per list and app-wide, estimated off the critical path, cancelled on
 * unmount) and "Clear cached data"; the space used and the breakdown are read again afterwards.
 */
export function StorageSection({
  loadStatus = getStorageStatus,
  requestPersist = requestPersistentStorage,
  isIOS = () => getCapabilities().isIOS,
  isInstalled = isInstalledApp,
  loadBreakdown = (signal) => loadStorageBreakdown(signal),
  clear = (selection) => clearCachedData(selection),
  restart = () => backupRestart.restartOnLists(),
}: StorageSectionProps) {
  const text = t.settings.storage;
  const [status, setStatus] = useState<StorageStatus>();
  /** The browser's last answer to "Ask again" (when `persisted()` itself cannot tell). */
  const [answer, setAnswer] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [iosWarning] = useState(() => isIOS() && !isInstalled());
  const mounted = useRef(true);
  const [breakdown, setBreakdown] = useState<BreakdownState>({ kind: 'loading' });
  /** Bumped after a clear: the breakdown and the space used are read again. */
  const [generation, setGeneration] = useState(0);
  const [clearOpen, setClearOpen] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadBreakdown(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setBreakdown({ kind: 'ready', data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        log.warn('settings: the storage breakdown could not be estimated', { error });
        setBreakdown({ kind: 'failed' });
      },
    );
    return () => controller.abort();
  }, [loadBreakdown, generation]);

  useEffect(() => {
    mounted.current = true;
    loadStatus().then((next) => {
      if (mounted.current) setStatus(next);
    });
    return () => {
      mounted.current = false;
    };
  }, [loadStatus, generation]);

  const request = async () => {
    setBusy(true);
    try {
      const granted = await requestPersist();
      const next = await loadStatus();
      if (!mounted.current) return;
      setAnswer(granted);
      setStatus(next);
    } catch (error) {
      log.warn('settings: the storage status could not be refreshed', { error });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const persisted = status?.persisted ?? answer;
  let persistedText = text.persistedUnknown;
  if (persisted === true) persistedText = text.persistedOn;
  else if (persisted === false) persistedText = text.persistedOff;

  let usageText = text.usageUnknown;
  if (status?.usage !== undefined) {
    usageText =
      status.quota !== undefined
        ? text.usageOf(formatBytes(status.usage), formatBytes(status.quota))
        : formatBytes(status.usage);
  }

  return (
    <SettingsSection title={t.settings.sections.storage}>
      <Stack spacing={2}>
        {iosWarning && <Alert severity="warning">{text.iosInstall}</Alert>}
        {status && (
          <>
            <Box>
              <Typography variant="subtitle1" component="h3">
                {text.persisted}
              </Typography>
              <Typography color="text.secondary">{persistedText}</Typography>
              {/* Also when `persisted()` is missing but `persist()` exists (older Safari). */}
              {persisted !== true && status.canPersist && (
                <Button sx={{ mt: 1 }} variant="outlined" onClick={request} disabled={busy}>
                  {text.request}
                </Button>
              )}
              {answer === false && (
                <Typography role="status" color="text.secondary" sx={{ mt: 1 }}>
                  {text.requestDenied}
                </Typography>
              )}
            </Box>
            <Box>
              <Typography variant="subtitle1" component="h3">
                {text.usage}
              </Typography>
              <Typography color="text.secondary">{usageText}</Typography>
            </Box>
          </>
        )}
        <StorageBreakdownView state={breakdown} />
        <Box>
          <Button
            variant="outlined"
            disabled={breakdown.kind !== 'ready'}
            onClick={() => {
              setCleared(false);
              setClearOpen(true);
            }}
          >
            {t.settings.storage.clear.action}
          </Button>
          {cleared && (
            <Typography role="status" color="text.secondary" sx={{ mt: 1 }}>
              {t.settings.storage.clear.done}
            </Typography>
          )}
        </Box>
        {clearOpen && breakdown.kind === 'ready' && (
          <ClearCachedDataDialog
            open
            breakdown={breakdown.data}
            clear={clear}
            restart={restart}
            onClose={() => setClearOpen(false)}
            onCleared={() => {
              setClearOpen(false);
              setCleared(true);
              setBreakdown({ kind: 'loading' });
              setGeneration((g) => g + 1);
            }}
          />
        )}
      </Stack>
    </SettingsSection>
  );
}
