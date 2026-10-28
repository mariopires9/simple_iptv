// Placeholder for Settings › Privacy and data, the target of onboarding's "Learn more" (UX-01).
// TODO(UX-04): replaced by the real page in features/settings (what is stored, Delete all data).
import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

export function PrivacyScreen() {
  const text = t.onboarding.privacy;
  return (
    <>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <Typography sx={{ maxWidth: 720, mb: 2 }}>{text.storage}</Typography>
      <Typography sx={{ maxWidth: 720 }} color="text.secondary">
        {text.noChannels}
      </Typography>
    </>
  );
}
