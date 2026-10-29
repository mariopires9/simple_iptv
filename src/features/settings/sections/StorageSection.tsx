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

/** Injectable platform checks (tests). */
export interface StorageSectionProps {
  loadStatus?: () => Promise<StorageStatus>;
  requestPersist?: () => Promise<boolean | undefined>;
  /** iOS/iPadOS (any browser there is Safari's WebKit). */
  isIOS?: () => boolean;
  isInstalled?: () => boolean;
}

/**
 * Settings › Storage (PWA-05): whether the browser keeps the data (`persisted()`), a way to ask
 * again, the space used (`estimate()`), and on iOS outside the installed app the 7-day warning.
 */
export function StorageSection({
  loadStatus = getStorageStatus,
  requestPersist = requestPersistentStorage,
  isIOS = () => getCapabilities().isIOS,
  isInstalled = isInstalledApp,
}: StorageSectionProps) {
  const text = t.settings.storage;
  const [status, setStatus] = useState<StorageStatus>();
  /** The browser's last answer to "Ask again" (when `persisted()` itself cannot tell). */
  const [answer, setAnswer] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [iosWarning] = useState(() => isIOS() && !isInstalled());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadStatus().then((next) => {
      if (mounted.current) setStatus(next);
    });
    return () => {
      mounted.current = false;
    };
  }, [loadStatus]);

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
      </Stack>
    </SettingsSection>
  );
}
