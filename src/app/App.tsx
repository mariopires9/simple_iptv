import Typography from '@mui/material/Typography';
import { t } from '@/i18n';
import { ThemeModeProvider } from '@/ui/theme';
import { AppShell } from './AppShell';

/** Theme + AppShell with placeholder content until FND-04 (routing) adds the screens. */
export function App() {
  return (
    <ThemeModeProvider>
      <AppShell>
        <Typography variant="h1">{t.app.name}</Typography>
        <Typography color="text.secondary">{t.app.placeholder}</Typography>
      </AppShell>
    </ThemeModeProvider>
  );
}
