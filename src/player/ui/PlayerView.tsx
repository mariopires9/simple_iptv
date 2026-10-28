// Player view (PLY-02, docs/UX_UI.md §4.5): owns the <video> element and one PlayerController,
// starts playback (with the autoplay policy), and renders the controls overlay, the buffering
// spinner, the playback error overlay and the screen-reader announcements.
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useEffect, useMemo, useRef, useState } from 'react';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { StateView, useDelayedFlag, visuallyHidden } from '@/ui/state';
import { errorName } from '../errors';
import type { PlaybackError, StreamDescriptor } from '../types';
import { describePlaybackError } from './describePlaybackError';
import {
  isSilent,
  liveEdgePosition,
  playMedia,
  seekMedia,
  setMediaMuted,
  setMediaVolume,
  startPlayback,
} from './media';
import { PlayerControls, type SeekWindow } from './PlayerControls';
import { useAutoHide } from './useAutoHide';
import { useMediaState } from './useMediaState';
import { usePlayerController, type ControllerFactory } from './usePlayerController';
import { useShortcuts } from './useShortcuts';

/** A live stream shows a seek bar only when its seekable (DVR) window is longer than this. */
export const DVR_MIN_WINDOW_S = 30;
/** The buffering spinner only appears after this long, so short stalls do not flash. */
export const BUFFERING_SPINNER_DELAY_MS = 500;

export interface PlayerViewProps {
  descriptor: StreamDescriptor;
  /** Channel or content name (top bar and the region's accessible name). */
  title: string;
  /** Defaults to `descriptor.kind`. */
  kind?: 'live' | 'vod';
  /** VOD resume position (seconds). Changing it (or the descriptor, by value) reloads. */
  startAt?: number;
  /** ↑ / previous-channel button (live). */
  onPrevious?: () => void;
  /** ↓ / next-channel button (live). */
  onNext?: () => void;
  /** `L` / channel-list button (live). */
  onToggleChannelList?: () => void;
  /** `Esc` / back button. */
  onClose?: () => void;
  /** `F` / fullscreen button. TODO(PLY-03): fullscreen and PiP are implemented there. */
  onToggleFullscreen?: () => void;
  /** Focus the player region on mount so the shortcuts work right away. Default true. */
  autoFocus?: boolean;
  /** Controller factory (tests inject a fake). Default: `createPlayerController`. */
  createController?: ControllerFactory;
}

export function PlayerView({
  descriptor,
  title,
  kind = descriptor.kind,
  startAt,
  onPrevious,
  onNext,
  onToggleChannelList,
  onClose,
  onToggleFullscreen,
  autoFocus = true,
  createController,
}: PlayerViewProps) {
  const { videoRef, bound } = usePlayerController(createController);
  const video = bound?.video ?? null;
  const controller = bound?.controller;
  const media = useMediaState(video);
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);

  // One "load" per descriptor/startAt/retry; errors and readiness are tied to the load they
  // belong to, so a new load starts clean without resetting state inside an effect.
  // The descriptor is compared by value: a parent re-creating an equal object must not reload.
  const [stream, setStream] = useState(descriptor);
  if (stream !== descriptor && JSON.stringify(stream) !== JSON.stringify(descriptor)) {
    setStream(descriptor);
  }
  const [retries, setRetries] = useState(0);
  const load = useMemo(
    () => ({ descriptor: stream, startAt, retries }),
    [stream, startAt, retries],
  );
  const [failure, setFailure] = useState<{ load: object; error: PlaybackError }>();
  const [readyFor, setReadyFor] = useState<object>();
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const error = failure?.load === load ? failure.error : undefined;
  const loading = readyFor !== load && error === undefined;

  useEffect(() => {
    if (!controller || !video) return undefined;
    let current = true;
    let failed = false;
    const offError = controller.on('error', (e) => {
      if (!current) return;
      failed = true;
      setFailure({ load, error: e });
    });
    // Readiness listeners are attached only once controller.play() resolved: by then the
    // previous stream has been torn down, so its late events cannot mark this load ready.
    const markReady = () => {
      if (current) setReadyFor(load);
    };
    const READY = ['loadeddata', 'canplay', 'playing'] as const;
    let listening = false;
    const HAVE_CURRENT_DATA = 2;

    const options = load.startAt !== undefined ? { startAt: load.startAt } : {};
    void controller
      .play(load.descriptor, options)
      .then(async () => {
        if (!current || failed) return;
        for (const type of READY) video.addEventListener(type, markReady);
        listening = true;
        if (video.readyState >= HAVE_CURRENT_DATA) markReady();
        const outcome = await startPlayback(video, () => {
          // Before the muted retry fires its events, so the announcer gives the autoplay
          // notice priority over a plain "Muted" / "Playing".
          if (current) setAutoplayMuted(true);
        });
        if (current && outcome === 'blocked') setAutoplayMuted(false);
      })
      .catch((e: unknown) => log.error('player: start failed', { error: errorName(e) }));

    return () => {
      current = false;
      offError();
      if (listening) for (const type of READY) video.removeEventListener(type, markReady);
    };
  }, [controller, video, load]);

  // --- announcements (polite live region) -------------------------------------------------
  const buffering = (loading || (media.waiting && !media.paused)) && error === undefined;
  const showSpinner = useDelayedFlag(buffering, BUFFERING_SPINNER_DELAY_MS);
  // Volume 0 is presented (icon, label, announcement) exactly like muted.
  const silent = media.muted || media.volume === 0;
  const [seen, setSeen] = useState({
    paused: media.paused,
    silent,
    spinner: showSpinner,
  });
  if (seen.paused !== media.paused || seen.silent !== silent || seen.spinner !== showSpinner) {
    // Adjusting state while rendering (React's documented pattern for derived transitions).
    setSeen({ paused: media.paused, silent, spinner: showSpinner });
    const a = t.player.announce;
    const mutedNow = silent && !seen.silent;
    const startedNow = !media.paused && seen.paused;
    if (showSpinner && !seen.spinner) setAnnouncement(a.buffering);
    else if (autoplayMuted && silent && (mutedNow || startedNow)) {
      // Transitions caused by the muted-autoplay fallback: the notice wins.
      setAnnouncement(a.mutedAutoplay);
    } else if (seen.silent !== silent) setAnnouncement(silent ? a.muted : a.unmuted);
    else if (seen.paused !== media.paused && !(media.paused && loading)) {
      setAnnouncement(media.paused ? a.paused : a.playing);
    }
  }

  // --- seek model -------------------------------------------------------------------------
  const dvr = kind === 'live' && media.seekableEnd - media.seekableStart > DVR_MIN_WINDOW_S;
  let seek: SeekWindow | undefined;
  if (kind === 'vod') {
    const end =
      Number.isFinite(media.duration) && media.duration > 0 ? media.duration : media.seekableEnd;
    if (end > 0) seek = { min: 0, max: end, value: media.currentTime };
  } else if (dvr) {
    seek = { min: media.seekableStart, max: media.seekableEnd, value: media.currentTime };
  }

  // --- actions ----------------------------------------------------------------------------
  const togglePlay = () => {
    if (!video || error) return;
    if (video.paused) playMedia(video);
    else video.pause();
  };
  // Last audible volume, restored when unmuting after the slider was dragged to 0.
  const lastVolume = useRef(1);
  const setMuted = (muted: boolean) => {
    if (!video) return;
    setMediaMuted(video, muted, lastVolume.current);
    if (!muted) setAutoplayMuted(false);
  };
  const toggleMute = () => {
    if (video) setMuted(!isSilent(video));
  };
  const setVolume = (volume: number) => {
    if (!video) return;
    setMediaVolume(video, volume);
    if (volume > 0) {
      lastVolume.current = volume;
      setAutoplayMuted(false);
    }
  };
  const seekTo = (time: number) => {
    if (video && seek) seekMedia(video, time, seek.min, seek.max);
  };
  const seekBy = (delta: number) => {
    if (video) seekTo(video.currentTime + delta);
  };
  const goLive = () => {
    if (!video) return;
    // TODO(PLY-05/engines): pass the HLS target duration once the controller exposes it.
    const edge = liveEdgePosition(media.seekableStart, media.seekableEnd);
    seekMedia(video, edge, media.seekableStart, media.seekableEnd);
    if (video.paused) playMedia(video);
  };
  const retry = () => setRetries((n) => n + 1);

  const isLive = kind === 'live';
  useShortcuts(region, {
    togglePlay,
    toggleFullscreen: onToggleFullscreen,
    toggleMute,
    seekBy: seek ? seekBy : undefined,
    previous: isLive ? onPrevious : undefined,
    next: isLive ? onNext : undefined,
    toggleChannelList: isLive ? onToggleChannelList : undefined,
    close: onClose,
  });

  const visible = useAutoHide({
    enabled: !media.paused && error === undefined,
    container: region,
    controls,
  });

  useEffect(() => {
    if (autoFocus && region && !region.contains(document.activeElement)) {
      region.focus({ preventScroll: true });
    }
  }, [autoFocus, region]);

  const errorText = error ? describePlaybackError(error) : undefined;
  const showUnmute = autoplayMuted && silent && error === undefined;

  return (
    <Box
      ref={setRegion}
      role="region"
      aria-label={t.player.region(title)}
      tabIndex={-1}
      data-testid="player-region"
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        bgcolor: 'common.black',
        color: 'common.white',
        cursor: visible ? 'auto' : 'none',
        '&:focus': { outline: 'none' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      {/* Captions/subtitles come from the stream's own text tracks (PLY-05); there is no
          separate caption file to attach here. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
      />

      {showSpinner && (
        <Box
          aria-hidden
          data-testid="player-spinner"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={72} sx={{ color: 'common.white' }} />
        </Box>
      )}

      <PlayerControls
        title={title}
        kind={kind}
        visible={visible}
        minimal={error !== undefined}
        paused={media.paused}
        muted={silent}
        volume={media.volume}
        seek={seek}
        dvr={dvr}
        controlsRef={setControls}
        onTogglePlay={togglePlay}
        onToggleMute={toggleMute}
        onVolume={setVolume}
        onSeek={seekTo}
        onSeekBy={seekBy}
        onGoLive={goLive}
        onPrevious={onPrevious}
        onNext={onNext}
        onToggleChannelList={onToggleChannelList}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />

      {showUnmute && (
        <Button
          variant="contained"
          data-testid="player-unmute"
          startIcon={<VolumeOffRounded aria-hidden />}
          onClick={() => setMuted(false)}
          sx={{ position: 'absolute', top: 72, right: 16, minHeight: 44 }}
        >
          {t.player.controls.unmute}
        </Button>
      )}

      {error && errorText && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            top: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            // Opaque theme surface: the StateView texts use the theme's text colors.
            bgcolor: 'background.default',
            color: 'text.primary',
          }}
        >
          {/* TODO(PLY-04): full error mapping, live retry backoff and "Next channel". */}
          <StateView
            variant="error"
            title={errorText.title}
            message={errorText.message}
            details={error.message}
            actions={
              <Button variant="contained" onClick={retry}>
                {t.state.actions.retry}
              </Button>
            }
          />
        </Box>
      )}

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
