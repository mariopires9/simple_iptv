import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { SettingsSection } from '../SettingsSection';

/**
 * Settings › Privacy (UX-04 AC1): the summary and the Privacy and data page (what is stored).
 * "Delete all data" (SRC-10) is on that page.
 */
export function PrivacySection() {
  const text = t.settings.privacy;
  return (
    <SettingsSection title={t.settings.sections.privacy}>
      <List disablePadding>
        <ListItemButton component={Link} to="/settings/privacy">
          <ListItemText primary={text.title} secondary={text.summary} />
          <ChevronRightRounded aria-hidden />
        </ListItemButton>
      </List>
    </SettingsSection>
  );
}
