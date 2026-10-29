import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import {
  getCapabilities,
  getStorageStatus,
  isInstalledApp,
  requestPersistentStorage,
  type StorageStatus,
} from '@/core/platform';
import { numberFormat, t } from '@/i18n';
import { SettingsSection } from '../SettingsSection';

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** `12.3 MB` in the active locale (decimal units, like the browsers' own storage settings). */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return numberFormat({
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

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
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [iosWarning] = useState(() => isIOS() && !isInstalled());

  const refresh = useCallback(() => loadStatus().then(setStatus), [loadStatus]);
  useEffect(() => {
    let active = true;
    loadStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, [loadStatus]);

  const request = async () => {
    setBusy(true);
    const granted = await requestPersist();
    setDenied(granted === false);
    await refresh();
    setBusy(false);
  };

  let persistedText = text.persistedUnknown;
  if (status?.persisted === true) persistedText = text.persistedOn;
  else if (status?.persisted === false) persistedText = text.persistedOff;

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
              {status.persisted === false && (
                <Button sx={{ mt: 1 }} variant="outlined" onClick={request} disabled={busy}>
                  {text.request}
                </Button>
              )}
              {denied && (
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
