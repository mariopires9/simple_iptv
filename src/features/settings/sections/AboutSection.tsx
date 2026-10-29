import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { DelayedLoading, StateView } from '@/ui/state';
// Named JSON import: the bundler keeps only `version`, not the rest of package.json.
import { version as APP_VERSION } from '../../../../package.json';
import { loadLicenses, type LicenseEntry } from '../licenses';
import { SettingsSection } from '../SettingsSection';

type LicensesState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; packages: LicenseEntry[] };

export interface AboutSectionProps {
  version?: string;
  /** Loads the build-time list (tests inject it). */
  load?: () => Promise<LicenseEntry[]>;
}

/**
 * Settings › About (UX-04 AC1–AC3): version from the build, the open-source licenses (generated at
 * build time, fetched only when opened) and the legal notice.
 */
export function AboutSection({ version = APP_VERSION, load = loadLicenses }: AboutSectionProps) {
  const text = t.settings.about;
  const listId = useId();
  const [licenses, setLicenses] = useState<LicensesState>({ status: 'closed' });
  const open = licenses.status !== 'closed';

  const fetchList = () => {
    setLicenses({ status: 'loading' });
    load().then(
      (packages) => setLicenses({ status: 'ready', packages }),
      (error: unknown) => {
        log.warn('settings: the licenses list could not be loaded', { error });
        setLicenses({ status: 'error' });
      },
    );
  };

  return (
    <SettingsSection title={t.settings.sections.about}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle1" component="h3">
            {text.version}
          </Typography>
          <Typography color="text.secondary">{version}</Typography>
        </Box>
        <Typography>{text.legal}</Typography>
        <Box>
          <Button
            variant="text"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            endIcon={open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
            onClick={() => (open ? setLicenses({ status: 'closed' }) : fetchList())}
            sx={{ px: 0 }}
          >
            {text.licenses}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {text.licensesHint}
          </Typography>
          {open && (
            <Box id={listId} sx={{ mt: 1 }}>
              {licenses.status === 'loading' && (
                <DelayedLoading>
                  <Typography role="status">{text.licensesLoading}</Typography>
                </DelayedLoading>
              )}
              {licenses.status === 'error' && (
                <StateView
                  variant="error"
                  headingLevel={3}
                  title={text.licensesUnavailable}
                  actions={<Button onClick={fetchList}>{t.state.actions.retry}</Button>}
                />
              )}
              {licenses.status === 'ready' && (
                <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
                  {licenses.packages.map((entry) => (
                    <Typography
                      component="li"
                      variant="body2"
                      key={`${entry.name}@${entry.version}`}
                      sx={{ py: 0.25, overflowWrap: 'anywhere' }}
                    >
                      {entry.name} {entry.version}
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        {' · '}
                        {entry.license}
                      </Box>
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Stack>
    </SettingsSection>
  );
}
