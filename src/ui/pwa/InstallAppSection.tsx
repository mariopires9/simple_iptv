// "Install app" section for Settings (PWA-01 AC3). Chrome/Edge: a button that opens the browser's
// install dialog (`beforeinstallprompt`). iPhone/iPad: the "Share → Add to Home Screen" steps.
// Installed: a short status line. Other browsers: nothing (they offer no install prompt).
// Strings: the `install` namespace, which the hosting route must declare (`lazyScreen`).
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import InstallMobileOutlined from '@mui/icons-material/InstallMobileOutlined';
import IosShareOutlined from '@mui/icons-material/IosShareOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import type { InstallPromptStore } from '@/core/platform';
import { t } from '@/i18n';
import { useInstallPrompt } from './useInstallPrompt';

export interface InstallAppSectionProps {
  /** Heading level of the section title (default 2: a section inside the Settings screen). */
  headingLevel?: 2 | 3;
  /** Tests: an install prompt store other than the app's. */
  store?: InstallPromptStore;
}

export function InstallAppSection({ headingLevel = 2, store }: InstallAppSectionProps) {
  const { state, promptInstall } = useInstallPrompt(store);
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const titleId = useId();
  const text = t.install;

  if (state === 'unsupported' && !dismissed) return null;

  const onInstall = async () => {
    setPending(true);
    try {
      // The store never rejects; a failure is treated like an unavailable prompt.
      const outcome = await promptInstall().catch(() => 'unavailable' as const);
      setDismissed(outcome === 'dismissed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Box component="section" aria-labelledby={titleId} sx={{ py: 2 }}>
      <Typography id={titleId} variant="h6" component={`h${headingLevel}`} gutterBottom>
        {text.title}
      </Typography>
      {state === 'installed' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CheckCircleOutlined aria-hidden fontSize="small" color="success" />
          <Typography>{text.installed}</Typography>
        </Stack>
      )}
      {state === 'unsupported' && (
        // Only after a dismissal (otherwise nothing renders): no install is on offer any more, so
        // the text promises nothing.
        <Typography color="text.secondary" role="status">
          {text.dismissed}
        </Typography>
      )}
      {(state === 'available' || state === 'ios') && (
        <>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {text.description}
          </Typography>
          {state === 'available' && (
            <Button
              variant="contained"
              startIcon={<InstallMobileOutlined aria-hidden />}
              onClick={() => void onInstall()}
              disabled={pending}
            >
              {text.button}
            </Button>
          )}
          {state === 'ios' && (
            <>
              <Typography>{text.ios.intro}</Typography>
              <Box component="ol" sx={{ mt: 1, mb: 0, pl: 3 }}>
                <li>
                  <Typography component="span">{text.ios.share}</Typography>{' '}
                  <IosShareOutlined
                    aria-hidden
                    fontSize="small"
                    sx={{ verticalAlign: 'text-bottom' }}
                  />
                </li>
                <li>
                  <Typography component="span">{text.ios.addToHomeScreen}</Typography>
                </li>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
