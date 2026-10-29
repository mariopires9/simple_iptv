// Player controls overlay (PLY-02, docs/UX_UI.md §4.5). Presentational: PlayerView owns the media
// element and passes state + actions. Hidden controls stay in the tab order (opacity only), so
// keyboard focus can reach them and reveal the overlay.
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import Forward10Rounded from '@mui/icons-material/Forward10Rounded';
import FullscreenExitRounded from '@mui/icons-material/FullscreenExitRounded';
import FullscreenRounded from '@mui/icons-material/FullscreenRounded';
import ListRounded from '@mui/icons-material/ListRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PictureInPictureAltRounded from '@mui/icons-material/PictureInPictureAltRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import Replay10Rounded from '@mui/icons-material/Replay10Rounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRounded from '@mui/icons-material/SkipPreviousRounded';
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { ReactNode, Ref } from 'react';
import { t } from '@/i18n';
import { formatPercent, formatTime } from './formatTime';
import { AUTO_HIDE_KEEP_ATTR } from './useAutoHide';
import { SEEK_STEP_S } from './useShortcuts';
import { ProgressBar } from './ProgressBar';

export interface SeekWindow {
  min: number;
  max: number;
  value: number;
}

export interface PlayerControlsProps {
  title: string;
  kind: 'live' | 'vod';
  visible: boolean;
  /** Only the top bar (back + title) is shown, e.g. under the error overlay. */
  minimal?: boolean;
  paused: boolean;
  muted: boolean;
  volume: number;
  /** VOD position or live DVR window; undefined = no seek bar. */
  seek?: SeekWindow | undefined;
  /** Live stream with a DVR window (seek bar + "Go live"). */
  dvr: boolean;
  controlsRef?: Ref<HTMLDivElement>;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  onSeek: (time: number) => void;
  onSeekBy: (delta: number) => void;
  onGoLive: () => void;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onToggleChannelList?: (() => void) | undefined;
  /** Fullscreen button; omitted where the platform has no fullscreen at all. */
  onToggleFullscreen?: (() => void) | undefined;
  /** Currently fullscreen (button label/icon: "Exit fullscreen"). */
  fullscreen?: boolean;
  /** Picture-in-Picture button; omitted where PiP is not supported (PLY-03 AC4). */
  onTogglePictureInPicture?: (() => void) | undefined;
  pictureInPicture?: boolean;
  onClose?: (() => void) | undefined;
}

const scrim = (theme: Theme) => alpha(theme.palette.common.black, 0.55);
const liveColor = (theme: Theme) =>
  (theme.palette.tokens as Theme['palette']['tokens'] | undefined)?.live ??
  theme.palette.error.main;

/** The pointer resting over these parts keeps the controls visible (useAutoHide). */
const keep = { [AUTO_HIDE_KEEP_ATTR]: '' };

const iconButtonSx = { color: 'common.white', minWidth: 44, minHeight: 44 } as const;

function Control({
  label,
  onClick,
  children,
  large = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <IconButton
      aria-label={label}
      onClick={onClick}
      size={large ? 'large' : 'medium'}
      sx={large ? { ...iconButtonSx, '& svg': { fontSize: 48 } } : iconButtonSx}
    >
      {children}
    </IconButton>
  );
}

export function LiveIndicator() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.25,
        borderRadius: 999,
        bgcolor: scrim,
        color: 'common.white',
        typography: 'caption',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        flexShrink: 0,
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: liveColor }}
      />
      {t.player.live}
    </Box>
  );
}

export function PlayerControls({
  title,
  kind,
  visible,
  minimal = false,
  paused,
  muted,
  volume,
  seek,
  dvr,
  controlsRef,
  onTogglePlay,
  onToggleMute,
  onVolume,
  onSeek,
  onSeekBy,
  onGoLive,
  onPrevious,
  onNext,
  onToggleChannelList,
  onToggleFullscreen,
  fullscreen = false,
  onTogglePictureInPicture,
  pictureInPicture = false,
  onClose,
}: PlayerControlsProps) {
  const c = t.player.controls;
  const isLive = kind === 'live';

  return (
    <Box
      ref={controlsRef}
      data-testid="player-controls"
      data-visible={visible}
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: 'common.white',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: (theme) =>
          theme.transitions.create('opacity', { duration: theme.transitions.duration.short }),
        // Hidden controls still reveal themselves when they receive keyboard focus.
        '&:focus-within': { opacity: 1 },
      }}
    >
      {/* Top: back · title · live indicator */}
      <Box
        {...keep}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: scrim, minWidth: 0 }}
      >
        {onClose && (
          <Control label={c.close} onClick={onClose}>
            <ArrowBackRounded />
          </Control>
        )}
        <Typography
          component="h2"
          variant="subtitle1"
          noWrap
          sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}
        >
          {title}
        </Typography>
        {isLive && <LiveIndicator />}
      </Box>

      {!minimal && (
        <>
          {/* Center: previous · play/pause · next (live) or −10 s · play/pause · +10 s (VOD) */}
          <Box
            {...keep}
            sx={{ display: 'flex', alignSelf: 'center', alignItems: 'center', gap: 3 }}
          >
            {isLive
              ? onPrevious && (
                  <Control label={c.previousChannel} onClick={onPrevious}>
                    <SkipPreviousRounded />
                  </Control>
                )
              : seek && (
                  <Control label={c.back10} onClick={() => onSeekBy(-SEEK_STEP_S)}>
                    <Replay10Rounded />
                  </Control>
                )}
            <Control large label={paused ? c.play : c.pause} onClick={onTogglePlay}>
              {paused ? <PlayArrowRounded /> : <PauseRounded />}
            </Control>
            {isLive
              ? onNext && (
                  <Control label={c.nextChannel} onClick={onNext}>
                    <SkipNextRounded />
                  </Control>
                )
              : seek && (
                  <Control label={c.forward10} onClick={() => onSeekBy(SEEK_STEP_S)}>
                    <Forward10Rounded />
                  </Control>
                )}
          </Box>

          {/* Bottom: progress · volume · channel list · fullscreen */}
          <Box {...keep} sx={{ px: 1, pb: 1, bgcolor: scrim }}>
            {seek && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 1 }}>
                {!isLive && (
                  <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(seek.value)}
                  </Typography>
                )}
                <ProgressBar value={seek.value} min={seek.min} max={seek.max} onSeek={onSeek} />
                {!isLive && (
                  <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(seek.max)}
                  </Typography>
                )}
              </Box>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Control label={muted ? c.unmute : c.mute} onClick={onToggleMute}>
                {muted ? <VolumeOffRounded /> : <VolumeUpRounded />}
              </Control>
              <Slider
                size="small"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label={c.volume}
                getAriaValueText={(v) => formatPercent(v)}
                onChange={(_, v) => onVolume(v)}
                sx={{ width: 96, color: 'common.white', mx: 1 }}
              />
              {dvr && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onGoLive}
                  sx={{ color: 'common.white', borderColor: 'currentColor', minHeight: 44 }}
                >
                  {c.goLive}
                </Button>
              )}
              <Box sx={{ flex: 1 }} />
              {isLive && onToggleChannelList && (
                <Control label={c.channelList} onClick={onToggleChannelList}>
                  <ListRounded />
                </Control>
              )}
              {onTogglePictureInPicture && (
                <Control
                  label={pictureInPicture ? c.exitPictureInPicture : c.pictureInPicture}
                  onClick={onTogglePictureInPicture}
                >
                  <PictureInPictureAltRounded />
                </Control>
              )}
              {onToggleFullscreen && (
                <Control
                  label={fullscreen ? c.exitFullscreen : c.fullscreen}
                  onClick={onToggleFullscreen}
                >
                  {fullscreen ? <FullscreenExitRounded /> : <FullscreenRounded />}
                </Control>
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
