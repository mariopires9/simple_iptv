import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

/** Placeholder (FND-04): first-use onboarding (no sources yet). */
export function OnboardingScreen() {
  const text = t.routes.screens.onboarding;
  return (
    <>
      <Typography variant="h1">{text.title}</Typography>
      <Typography color="text.secondary">{text.empty}</Typography>
    </>
  );
}
