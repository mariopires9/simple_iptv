import Typography from '@mui/material/Typography';
import { t } from '@/i18n';
import { SETTINGS_SECTIONS } from './sections';

/**
 * Settings (UX-04, docs/UX_UI.md §4.8): Lists · Appearance · Language · Playback · Proxy · Backup · Storage ·
 * Privacy · About, one component per section (`./sections`).
 */
export function SettingsScreen() {
  return (
    <>
      <Typography variant="h1" gutterBottom>
        {t.routes.screens.settings.title}
      </Typography>
      {SETTINGS_SECTIONS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
