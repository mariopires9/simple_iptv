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
  saveHideProtectedContent,
  saveLiveFormat,
  savePlayLastChannelOnOpen,
  saveShowOpenInVlc,
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
 * Settings › Playback (UX-04 AC1): fullscreen in landscape, play the last channel on open, hide
 * protected content (UX-07) and the active list's preferred live format (Xtream only). Each change is saved at once; a failed save
 * puts the control back and says so.
 */
/** One field of the section's state: how to read it and how to write it back. */
interface SettingField<V> {
  get: (settings: PlaybackSettings) => V;
  set: (settings: PlaybackSettings, value: V) => PlaybackSettings;
}

const FULLSCREEN: SettingField<boolean> = {
  get: (s) => s.fullscreenOnLandscape,
  set: (s, fullscreenOnLandscape) => ({ ...s, fullscreenOnLandscape }),
};
const SHOW_VLC: SettingField<boolean> = {
  get: (s) => s.showOpenInVlc,
  set: (s, showOpenInVlc) => ({ ...s, showOpenInVlc }),
};
const PLAY_LAST: SettingField<boolean> = {
  get: (s) => s.playLastChannelOnOpen,
  set: (s, playLastChannelOnOpen) => ({ ...s, playLastChannelOnOpen }),
};
const HIDE_PROTECTED: SettingField<boolean> = {
  get: (s) => s.hideProtectedContent,
  set: (s, hideProtectedContent) => ({ ...s, hideProtectedContent }),
};
/** The active list's live format (`undefined` without a list: nothing to set). */
const LIVE_FORMAT: SettingField<LiveFormat | undefined> = {
  get: (s) => s.activeList?.liveFormat,
  set: (s, liveFormat) =>
    s.activeList && liveFormat ? { ...s, activeList: { ...s.activeList, liveFormat } } : s,
};

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

  /**
   * Optimistic update of one field; if its save fails, only that field goes back (and only if it
   * still holds the value that failed: a later change of it, or of another field, is kept).
   */
  const change = <V,>(field: SettingField<V>, value: V, save: () => Promise<void>) => {
    const previous = field.get(settings);
    setSettings((current) => current && field.set(current, value));
    save().catch((error: unknown) => {
      log.warn('settings: a playback setting could not be saved', { error });
      setSettings((current) =>
        current && field.get(current) === value ? field.set(current, previous) : current,
      );
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
            change(FULLSCREEN, checked, () => saveFullscreenOnLandscape(checked))
          }
        />
        <SwitchRow
          label={text.showOpenInVlc}
          hint={text.showOpenInVlcHint}
          checked={settings.showOpenInVlc}
          onChange={(checked) => change(SHOW_VLC, checked, () => saveShowOpenInVlc(checked))}
        />
        <SwitchRow
          label={text.playLastChannel}
          hint={text.playLastChannelHint}
          checked={settings.playLastChannelOnOpen}
          onChange={(checked) =>
            change(PLAY_LAST, checked, () => savePlayLastChannelOnOpen(checked))
          }
        />
        <SwitchRow
          label={text.hideProtected}
          hint={text.hideProtectedHint}
          checked={settings.hideProtectedContent}
          onChange={(checked) =>
            change(HIDE_PROTECTED, checked, () => saveHideProtectedContent(checked))
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
              change(LIVE_FORMAT, liveFormat, () => saveLiveFormat(xtream.id, liveFormat));
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
