import { Link } from 'react-router';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Settings entry points (SRC-08 AC0). The full Settings page (theme, language, playback…) is UX-04. */
export function SettingsScreen() {
  const text = t.routes.screens.settings;
  const items = [
    { to: '/settings/sources', primary: text.myLists, secondary: text.myListsHint },
    { to: '/settings/privacy', primary: text.privacy, secondary: text.privacyHint },
  ];
  return (
    <>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <List aria-label={text.title}>
        {items.map((item) => (
          <ListItemButton key={item.to} component={Link} to={item.to}>
            <ListItemText primary={item.primary} secondary={item.secondary} />
          </ListItemButton>
        ))}
      </List>
    </>
  );
}
