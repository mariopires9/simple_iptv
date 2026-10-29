import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { useId } from 'react';
import { t } from '@/i18n';
import { THEME_PREFERENCES, useThemeMode, type ThemePreference } from '@/ui/theme';
import { SettingsSection } from '../SettingsSection';

/** Settings › Appearance: the theme (System / Dark / Light, FND-03), same store as the top bar. */
export function AppearanceSection() {
  const { preference, setPreference } = useThemeMode();
  const labelId = useId();
  return (
    <SettingsSection title={t.settings.sections.appearance}>
      <FormControl>
        <FormLabel id={labelId}>{t.settings.appearance.theme}</FormLabel>
        <RadioGroup
          aria-labelledby={labelId}
          value={preference}
          onChange={(event) => setPreference(event.target.value as ThemePreference)}
        >
          {THEME_PREFERENCES.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio />}
              label={t.nav.themes[option]}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </SettingsSection>
  );
}
