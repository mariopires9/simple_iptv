// First-run onboarding (UX-01, docs/UX_UI.md §4.1): the three ways to add a list, Xtream first
// (recommended), and the privacy note. Each option opens its own full-screen route.
import ChevronRight from '@mui/icons-material/ChevronRight';
import DnsOutlined from '@mui/icons-material/DnsOutlined';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import LinkIcon from '@mui/icons-material/Link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';

interface SourceOption {
  id: 'xtream' | 'm3uUrl' | 'm3uFile';
  to: string;
  icon: ReactNode;
}

const OPTIONS: readonly SourceOption[] = [
  { id: 'xtream', to: '/onboarding/xtream', icon: <DnsOutlined /> },
  { id: 'm3uUrl', to: '/onboarding/m3u-url', icon: <LinkIcon /> },
  { id: 'm3uFile', to: '/onboarding/m3u-file', icon: <InsertDriveFileOutlined /> },
];

export function OnboardingScreen() {
  const text = t.onboarding;
  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      <Typography color="text.secondary">{text.intro}</Typography>

      <Typography variant="h2" sx={{ mt: 4, mb: 2, typography: 'subtitle1', fontWeight: 600 }}>
        {text.chooseType}
      </Typography>
      <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {OPTIONS.map((option) => {
          const optionText = text.options[option.id];
          const recommended = option.id === 'xtream';
          return (
            <li key={option.id}>
              <ButtonBase
                component={Link}
                to={option.to}
                focusRipple
                sx={{
                  width: '100%',
                  p: 2,
                  gap: 2,
                  minHeight: 72,
                  justifyContent: 'flex-start',
                  textAlign: 'start',
                  borderRadius: 2,
                  border: 1,
                  borderColor: recommended ? 'primary.main' : 'divider',
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.Mui-focusVisible': {
                    outline: 2,
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
              >
                <Box aria-hidden sx={{ display: 'flex', color: 'primary.main' }}>
                  {option.icon}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography component="span" sx={{ fontWeight: 600 }}>
                      {optionText.title}
                    </Typography>
                    {recommended && (
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          px: 1,
                          borderRadius: 1,
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          fontWeight: 600,
                        }}
                      >
                        {text.options.xtream.recommended}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {optionText.description}
                  </Typography>
                </Box>
                <ChevronRight aria-hidden sx={{ color: 'text.secondary' }} />
              </ButtonBase>
            </li>
          );
        })}
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
        {text.note}{' '}
        <MuiLink component={Link} to="/settings/privacy">
          {text.learnMore}
        </MuiLink>
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {text.legal}
      </Typography>
    </Box>
  );
}
