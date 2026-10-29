import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { Link } from 'react-router';
import { t } from '@/i18n';
import { SettingsSection } from '../SettingsSection';

/** Settings › Lists: the My lists page (SRC-08). */
export function SourcesSection() {
  const text = t.settings;
  return (
    <SettingsSection title={text.sections.sources}>
      <List disablePadding component="div">
        <ListItemButton component={Link} to="/settings/sources">
          <ListItemText primary={text.sources.myLists} secondary={text.sources.myListsHint} />
          <ChevronRightRounded aria-hidden />
        </ListItemButton>
      </List>
    </SettingsSection>
  );
}
