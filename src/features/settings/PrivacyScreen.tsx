// Settings › Privacy and data (UX-04 AC1): what is stored on this device and where it goes. Also
// the target of onboarding's "Learn more" (UX-01). "Delete all data" (SRC-10) is added here.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { t } from '@/i18n';

export function PrivacyScreen() {
  const text = t.settings.privacy;
  const stored = [
    text.stored.lists,
    text.stored.credentials,
    text.stored.catalog,
    text.stored.personal,
    text.stored.preferences,
  ];
  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <Typography sx={{ mb: 2 }}>{text.storage}</Typography>
      <Typography variant="h2" sx={{ mt: 3, mb: 1 }}>
        {text.whatWeStore}
      </Typography>
      <Box component="ul" sx={{ mt: 0, pl: 3 }}>
        {stored.map((line) => (
          <Typography component="li" key={line} sx={{ mb: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>
      <Typography sx={{ mb: 2 }}>{text.notSent}</Typography>
      <Typography color="text.secondary">{text.noChannels}</Typography>
    </Box>
  );
}
