import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import { useEffect, useId, useState } from 'react';
import type { LiveFormat } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { useToast } from '@/ui/state';
import {
  LIVE_FORMATS,
  loadPlaybackSettings,
  saveFullscreenOnLandscape,
  saveLiveFormat,
  savePlayLastChannelOnOpen,
  type PlaybackSettings,
} from '../playbackSettings';
import { SettingsSection } from '../SettingsSection';

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: { 'aria-describedby': hintId } }}
          />
        }
        label={label}
      />
      <FormHelperText id={hintId} sx={{ mt: 0, ml: 0 }}>
        {hint}
      </FormHelperText>
    </div>
  );
}

/**
 * Settings › Playback (UX-04 AC1): fullscreen in landscape, play the last channel on open, and the
 * active list's preferred live format (Xtream only). Each change is saved at once; a failed save
 * puts the control back and says so.
 */
export function PlaybackSection() {
  const text = t.settings.playback;
  const toast = useToast();
  const formatLabelId = useId();
  const [settings, setSettings] = useState<PlaybackSettings>();

  useEffect(() => {
    let active = true;
    loadPlaybackSettings().then(
      (loaded) => {
        if (active) setSettings(loaded);
      },
      (error: unknown) => log.warn('settings: the playback settings could not be read', { error }),
    );
    return () => {
      active = false;
    };
  }, []);

  if (!settings)
    return <SettingsSection title={t.settings.sections.playback}>{null}</SettingsSection>;

  /** Optimistic update; reverted (with a toast) if the save fails. */
  const change = (next: PlaybackSettings, save: () => Promise<void>) => {
    const previous = settings;
    setSettings(next);
    save().catch((error: unknown) => {
      log.warn('settings: a playback setting could not be saved', { error });
      setSettings(previous);
      toast.show({ message: text.saveError, severity: 'error' });
    });
  };

  const list = settings.activeList;
  const xtream = list?.kind === 'xtream' ? list : undefined;
  let formatHint = text.liveFormatNoList;
  if (xtream) formatHint = text.liveFormatHint(xtream.name);
  else if (list) formatHint = text.liveFormatNotXtream;

  return (
    <SettingsSection title={t.settings.sections.playback}>
      <Stack spacing={2}>
        <SwitchRow
          label={text.fullscreenOnLandscape}
          hint={text.fullscreenOnLandscapeHint}
          checked={settings.fullscreenOnLandscape}
          onChange={(checked) =>
            change({ ...settings, fullscreenOnLandscape: checked }, () =>
              saveFullscreenOnLandscape(checked),
            )
          }
        />
        <SwitchRow
          label={text.playLastChannel}
          hint={text.playLastChannelHint}
          checked={settings.playLastChannelOnOpen}
          onChange={(checked) =>
            change({ ...settings, playLastChannelOnOpen: checked }, () =>
              savePlayLastChannelOnOpen(checked),
            )
          }
        />
        <FormControl disabled={!xtream}>
          <FormLabel id={formatLabelId}>{text.liveFormat}</FormLabel>
          <RadioGroup
            row
            aria-labelledby={formatLabelId}
            value={xtream?.liveFormat ?? 'auto'}
            onChange={(event) => {
              if (!xtream) return;
              const liveFormat = event.target.value as LiveFormat;
              change({ ...settings, activeList: { ...xtream, liveFormat } }, () =>
                saveLiveFormat(xtream.id, liveFormat),
              );
            }}
          >
            {LIVE_FORMATS.map((format) => (
              <FormControlLabel
                key={format}
                value={format}
                control={<Radio />}
                label={text.liveFormats[format]}
              />
            ))}
          </RadioGroup>
          <FormHelperText sx={{ mx: 0 }}>{formatHint}</FormHelperText>
        </FormControl>
      </Stack>
    </SettingsSection>
  );
}
