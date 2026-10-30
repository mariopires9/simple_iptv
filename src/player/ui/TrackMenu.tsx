// Audio and subtitle track menu (PLY-05). Only rendered when the stream has a choice to make:
// more than one audio track, or at least one subtitle track.
import CheckRounded from '@mui/icons-material/CheckRounded';
import SubtitlesRounded from '@mui/icons-material/SubtitlesRounded';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import { t } from '@/i18n';
import type { MediaTrack, MediaTracks } from '../types';
import { OVERLAY_ATTRIBUTE } from './useShortcuts';

export function hasTrackChoice(tracks: MediaTracks): boolean {
  return tracks.audio.length > 1 || tracks.text.length > 0;
}

function languageName(language: string): string | undefined {
  try {
    return new Intl.DisplayNames([t.player.locale], { type: 'language' }).of(language);
  } catch {
    return undefined;
  }
}

/** The stream's name for the track, else its language's name, else "Track n". */
export function trackLabel(track: MediaTrack, index: number): string {
  if (track.label !== '') return track.label;
  const name = track.language !== undefined ? languageName(track.language) : undefined;
  return name ?? t.player.tracks.unnamed(new Intl.NumberFormat(t.player.locale).format(index + 1));
}

export interface TrackMenuProps {
  tracks: MediaTracks;
  onSelectAudio: (track: MediaTrack) => void;
  /** `undefined` = subtitles off. */
  onSelectText: (track: MediaTrack | undefined) => void;
}

export function TrackMenu({ tracks, onSelectAudio, onSelectText }: TrackMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const s = t.player.tracks;
  const close = () => setAnchor(null);

  const item = (key: string, label: string, checked: boolean, onClick: () => void) => (
    <MenuItem
      key={key}
      role="menuitemradio"
      aria-checked={checked}
      selected={checked}
      onClick={() => {
        onClick();
        close();
      }}
    >
      <ListItemIcon>{checked && <CheckRounded fontSize="small" />}</ListItemIcon>
      {label}
    </MenuItem>
  );

  return (
    <>
      <IconButton
        aria-label={s.menu}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? true : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ color: 'common.white', minWidth: 44, minHeight: 44 }}
      >
        <SubtitlesRounded />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        // Inside the player region, so it also shows in fullscreen; its keys are not shortcuts.
        disablePortal
        {...{ [OVERLAY_ATTRIBUTE]: '' }}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { sx: { maxHeight: '60vh' } } }}
      >
        {tracks.audio.length > 1 && <ListSubheader>{s.audio}</ListSubheader>}
        {tracks.audio.length > 1 &&
          tracks.audio.map((track, i) =>
            item(`a${track.id}`, trackLabel(track, i), track.id === tracks.audioId, () =>
              onSelectAudio(track),
            ),
          )}
        {tracks.text.length > 0 && <ListSubheader>{s.subtitles}</ListSubheader>}
        {tracks.text.length > 0 &&
          item('t-off', s.off, tracks.textId === undefined, () => onSelectText(undefined))}
        {tracks.text.map((track, i) =>
          item(`t${track.id}`, trackLabel(track, i), track.id === tracks.textId, () =>
            onSelectText(track),
          ),
        )}
      </Menu>
    </>
  );
}
