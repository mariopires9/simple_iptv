import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import {
  activeLocale,
  detectLocale,
  isLanguagePreference,
  LANGUAGE_PREFERENCES,
  languagePreference,
  setLanguagePreference,
  subscribeLanguagePreference,
  t,
  type LanguagePreference,
} from '@/i18n';
import { SettingsSection } from '../SettingsSection';

/**
 * A switch re-mounts the screen in the new language (src/app/App.tsx): the remounted section
 * puts the focus back on the chosen option, so keyboard and screen reader users keep their place.
 */
let refocusAfterSwitch = false;

/** Settings › Language (UX-06 AC2): System / English / Português, applied at once and saved. */
export function LanguageSection() {
  const preference = useSyncExternalStore(subscribeLanguagePreference, languagePreference);
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const text = t.settings.language;

  useEffect(() => {
    if (!refocusAfterSwitch) return;
    refocusAfterSwitch = false;
    groupRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);

  const label = (option: LanguagePreference) => {
    if (option === 'system') return text.system(text.names[detectLocale('system')]);
    // Language names are always shown in their own language (docs/UX_UI.md §4.8).
    return <span lang={option}>{text.names[option]}</span>;
  };

  return (
    <SettingsSection title={t.settings.sections.language}>
      <FormControl>
        <FormLabel id={labelId}>{text.label}</FormLabel>
        <RadioGroup
          ref={groupRef}
          aria-labelledby={labelId}
          value={preference}
          onChange={(event) => {
            const next = event.target.value;
            if (!isLanguagePreference(next)) return;
            // Only a locale change re-mounts (e.g. not English → System when System is English).
            refocusAfterSwitch = detectLocale(next) !== activeLocale();
            void setLanguagePreference(next);
          }}
        >
          {LANGUAGE_PREFERENCES.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio />}
              label={label(option)}
            />
          ))}
        </RadioGroup>
      </FormControl>
    </SettingsSection>
  );
}
