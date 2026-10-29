// Player view (PLY-02, docs/UX_UI.md §4.5): owns the <video> element and one PlayerController,
// starts playback (with the autoplay policy), and renders the controls overlay, the buffering
// spinner, the playback error overlay and the screen-reader announcements.
// PLY-03: fullscreen (Fullscreen API or the iPhone system player), landscape → fullscreen and
// Picture-in-Picture. PLY-04: live reconnects with backoff, the error mapping and its actions,
// and the "no sound" banner.
import FullscreenRounded from '@mui/icons-material/FullscreenRounded';
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { StateView, useDelayedFlag, visuallyHidden } from '@/ui/state';
import { errorName } from '../errors';
import type { PlaybackError, StreamDescriptor } from '../types';
import { AUDIO_CHECK_DELAY_MS, audioMissing } from './audioCheck';
import { formatCodecs } from './codecNames';
import { describePlaybackError, isTransientFailure } from './describePlaybackError';
import {
  isSilent,
  liveEdgePosition,
  playMedia,
  seekMedia,
  setMediaMuted,
  setMediaVolume,
  startPlayback,
} from './media';
import { detectPlayerPlatform, type PlayerPlatform } from './platform';
import { PlayerControls, type SeekWindow } from './PlayerControls';
import { useAutoHide } from './useAutoHide';
import { useFullscreen } from './useFullscreen';
import { useMediaState } from './useMediaState';
import { usePictureInPicture } from './usePictureInPicture';
import { usePlayerController, type ControllerFactory } from './usePlayerController';
import { useShortcuts } from './useShortcuts';

/** A live stream shows a seek bar only when its seekable (DVR) window is longer than this. */
export const DVR_MIN_WINDOW_S = 30;
/** The buffering spinner only appears after this long, so short stalls do not flash. */
export const BUFFERING_SPINNER_DELAY_MS = 500;
/**
 * Live: delays of the automatic reconnects after a transient network error (PLY-04 AC1). The
 * error overlay appears only when all of them failed. They are reset only after
 * {@link SUSTAINED_PLAYBACK_S} of real playback, so a stream that loads and drops again at once
 * still ends on the overlay.
 */
export const LIVE_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
/** Seconds of playback progress after which the reconnect attempts start again from zero. */
export const SUSTAINED_PLAYBACK_S = 10;
/**
 * Where the overlay's "Connection diagnostics" action leads (SRC-09 will add its own page).
 * The action is a router link: PlayerView is always rendered inside the app's router.
 */
export const DIAGNOSTICS_PATH = '/settings/sources';

/** A track the browser cannot decode, for one load (dismissible banner). */
interface TrackWarning {
  load: object;
  codec?: string;
  dismissed?: boolean;
}

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
  /** ↓ / next-channel button (live); also "Next channel" on the error overlay. */
  onNext?: () => void;
  /** `L` / channel-list button (live). */
  onToggleChannelList?: () => void;
  /** `Esc` / back button. `Esc` leaves fullscreen first. */
  onClose?: () => void;
  /**
   * Rotating the device to landscape during playback offers fullscreen ("Tap for fullscreen":
   * browsers require a gesture); back to portrait leaves a fullscreen entered that way.
   * Default: on for mobile devices. The setting itself belongs to UX-04.
   */
  fullscreenOnLandscape?: boolean;
  /**
   * The entry declares headers (Referer/User-Agent…) the browser cannot send: a 401/403 is then
   * explained as a provider restriction (PLY-04 AC8).
   */
  requiredHeaders?: boolean;
  /** Device capabilities (tests inject a profile). Default: detected once. */
  platform?: PlayerPlatform;
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
  fullscreenOnLandscape,
  requiredHeaders = false,
  platform: platformProp,
  autoFocus = true,
  createController,
}: PlayerViewProps) {
  const [platform] = useState(() => platformProp ?? detectPlayerPlatform());
  const { videoRef, bound } = usePlayerController(createController);
  const video = bound?.video ?? null;
  const controller = bound?.controller;
  const media = useMediaState(video);
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);

  // One "load" per descriptor/startAt/reload; errors and readiness are tied to the load they
  // belong to, so a new load starts clean without resetting state inside an effect.
  // The descriptor is compared by value: a parent re-creating an equal object must not reload.
  const [stream, setStream] = useState(descriptor);
  if (stream !== descriptor && JSON.stringify(stream) !== JSON.stringify(descriptor)) {
    setStream(descriptor);
  }
  // Bumped by "Try again" and by every automatic reconnect: each is a new load.
  const [reloads, setReloads] = useState(0);
  const load = useMemo(
    () => ({ descriptor: stream, startAt, reloads }),
    [stream, startAt, reloads],
  );
  const [failure, setFailure] = useState<{
    load: object;
    error: PlaybackError;
    /** The stream had played before this failure (a drop, not a refusal). */
    started: boolean;
  }>();
  const [readyFor, setReadyFor] = useState<object>();
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const error = failure?.load === load ? failure.error : undefined;
  const loading = readyFor !== load && error === undefined;

  // Live reconnects (PLY-04 AC1). Kept in the view rather than in the controller: "success"
  // means the stream actually plays (media events), which only the view observes — the
  // controller never calls video.play() — and the view shows the "Reconnecting…" state.
  // `started`: this stream reached its first frame at least once.
  const reconnects = useRef({ stream, count: 0, started: false });
  const isLiveRef = useRef(kind === 'live');
  useEffect(() => {
    isLiveRef.current = kind === 'live';
  });
  /** The reconnect whose delay is running, tied to the load that failed. */
  const [reconnectingFor, setReconnectingFor] = useState<object>();
  const waitingReconnect = reconnectingFor === load;
  /** "Reconnecting… (n of 3)" from the delay through the reconnect's own loading. */
  const [reconnectLabel, setReconnectLabel] = useState<{ stream: object; attempt: number }>();

  // "No sound" / "No picture" banners (PLY-04 AC3): from engine notices or decoder counters.
  const [noAudio, setNoAudio] = useState<TrackWarning>();
  const [noVideo, setNoVideo] = useState<TrackWarning>();
  /** The load whose engine found no audio track at all (silence is expected there). */
  const noAudioTrackFor = useRef<object>(undefined);

  useEffect(() => {
    if (!controller || !video) return undefined;
    let current = true;
    let failed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (reconnects.current.stream !== load.descriptor) {
      reconnects.current = { stream: load.descriptor, count: 0, started: false };
    }
    const offError = controller.on('error', (e) => {
      // A reconnect is already scheduled for this load: further errors are the same failure.
      if (!current || timer !== undefined) return;
      failed = true;
      const r = reconnects.current;
      const delay = LIVE_RECONNECT_DELAYS_MS[r.count];
      if (isLiveRef.current && isTransientFailure(e, r.started) && delay !== undefined) {
        r.count += 1;
        log.info('player: reconnecting', { attempt: r.count, delayMs: delay, kind: e.kind });
        setReconnectingFor(load);
        setReconnectLabel({ stream: load.descriptor, attempt: r.count });
        timer = setTimeout(() => {
          timer = undefined;
          if (current) setReloads((n) => n + 1);
        }, delay);
        return;
      }
      setFailure({ load, error: e, started: r.started });
    });
    const offNotice = controller.on('notice', (notice) => {
      if (!current) return;
      const warning = (codec: string | undefined): TrackWarning => ({
        load,
        ...(codec !== undefined ? { codec } : {}),
      });
      if (notice.type === 'audio-unsupported') setNoAudio(warning(notice.codec));
      else if (notice.type === 'video-unsupported') setNoVideo(warning(notice.codec));
      else if (notice.type === 'no-audio-track') noAudioTrackFor.current = load;
    });
    // Readiness listeners are attached only once controller.play() resolved: by then the
    // previous stream has been torn down, so its late events cannot mark this load ready.
    const markReady = () => {
      if (!current) return;
      setReadyFor(load);
      reconnects.current.started = true;
    };
    // Only sustained playback gives the next failure the full set of reconnects again.
    let progressFrom: number | undefined;
    const onPlaying = () => {
      progressFrom = video.currentTime;
    };
    // A seek (e.g. "Go live") moves the position without playing: measure from the new one.
    const onSeek = () => {
      if (progressFrom !== undefined) progressFrom = video.currentTime;
    };
    const onProgress = () => {
      if (!current || progressFrom === undefined) return;
      if (video.currentTime - progressFrom < SUSTAINED_PLAYBACK_S) return;
      progressFrom = undefined;
      if (reconnects.current.count > 0) {
        reconnects.current.count = 0;
        setReconnectLabel(undefined);
      }
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
        video.addEventListener('playing', onPlaying);
        video.addEventListener('timeupdate', onProgress);
        video.addEventListener('seeking', onSeek);
        video.addEventListener('seeked', onSeek);
        listening = true;
        if (video.readyState >= HAVE_CURRENT_DATA) markReady();
        if (!video.paused) onPlaying();
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
      if (timer !== undefined) clearTimeout(timer);
      offError();
      offNotice();
      if (listening) {
        for (const type of READY) video.removeEventListener(type, markReady);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('timeupdate', onProgress);
        video.removeEventListener('seeking', onSeek);
        video.removeEventListener('seeked', onSeek);
      }
    };
  }, [controller, video, load]);

  // Decoder counters, read after a few seconds of real playback of a ready load.
  const ready = readyFor === load;
  useEffect(() => {
    if (!video || !ready) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const arm = () => {
      disarm();
      timer = setTimeout(() => {
        timer = undefined;
        // Muted, volume 0 or a stream without audio: silence proves nothing.
        if (video.paused || video.muted || video.volume === 0) return;
        if (noAudioTrackFor.current === load || !audioMissing(video)) return;
        log.info('player: no audio decoded');
        setNoAudio((prev) => (prev?.load === load ? prev : { load }));
      }, AUDIO_CHECK_DELAY_MS);
    };
    const ARM = ['playing', 'volumechange'] as const;
    const DISARM = ['pause', 'waiting', 'emptied'] as const;
    if (!video.paused) arm();
    for (const type of ARM) video.addEventListener(type, arm);
    for (const type of DISARM) video.addEventListener(type, disarm);
    return () => {
      disarm();
      for (const type of ARM) video.removeEventListener(type, arm);
      for (const type of DISARM) video.removeEventListener(type, disarm);
    };
  }, [video, ready, load]);

  // --- announcements (polite live region) -------------------------------------------------
  const buffering =
    (loading || waitingReconnect || (media.waiting && !media.paused)) && error === undefined;
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
  const retry = () => {
    reconnects.current.count = 0;
    setReconnectLabel(undefined);
    setReloads((n) => n + 1);
  };

  const isLive = kind === 'live';
  const fullscreen = useFullscreen({
    region,
    video,
    fullscreenApi: platform.fullscreenApi,
    lockLandscape: platform.mobile,
    autoOnLandscape: fullscreenOnLandscape ?? platform.mobile,
    playing: !media.paused && error === undefined,
  });
  const pip = usePictureInPicture(video, platform.pip);
  const toggleFullscreen = fullscreen.mode !== 'none' ? fullscreen.toggle : undefined;

  useShortcuts(region, {
    togglePlay,
    toggleFullscreen,
    toggleMute,
    seekBy: seek ? seekBy : undefined,
    previous: isLive ? onPrevious : undefined,
    next: isLive ? onNext : undefined,
    toggleChannelList: isLive ? onToggleChannelList : undefined,
    // Esc leaves fullscreen first; only then does it close the player.
    close: fullscreen.active && fullscreen.mode === 'element' ? fullscreen.exit : onClose,
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

  const errorText =
    error && failure
      ? describePlaybackError(error, { kind, requiredHeaders, afterStart: failure.started })
      : undefined;
  const showUnmute = autoplayMuted && silent && error === undefined;
  const shown = (w: TrackWarning | undefined) =>
    w?.load === load && w.dismissed !== true && error === undefined ? w : undefined;
  const audioWarning = shown(noAudio);
  const videoWarning = shown(noVideo);
  const reconnectAttempt =
    reconnectLabel?.stream === stream && (loading || waitingReconnect) && error === undefined
      ? reconnectLabel.attempt
      : undefined;

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

      {reconnectAttempt !== undefined && (
        <Typography
          role="status"
          data-testid="player-reconnecting"
          variant="body2"
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: '20%',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100% - 32px)',
            px: 1.5,
            py: 0.5,
            borderRadius: 999,
            textAlign: 'center',
            pointerEvents: 'none',
            bgcolor: (theme) => alpha(theme.palette.common.black, 0.55),
          }}
        >
          {t.player.reconnecting(reconnectAttempt, LIVE_RECONNECT_DELAYS_MS.length)}
        </Typography>
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
        onToggleFullscreen={toggleFullscreen}
        fullscreen={fullscreen.active}
        onTogglePictureInPicture={pip.supported ? pip.toggle : undefined}
        pictureInPicture={pip.active}
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

      {fullscreen.rotationPrompt && (
        <Button
          variant="contained"
          size="large"
          data-testid="player-rotation-prompt"
          startIcon={<FullscreenRounded aria-hidden />}
          onClick={fullscreen.acceptRotationPrompt}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            minHeight: 56,
            px: 3,
          }}
        >
          {t.player.tapForFullscreen}
        </Button>
      )}

      {(audioWarning || videoWarning || fullscreen.nativeNote) && (
        <Box
          sx={{
            position: 'absolute',
            top: 64,
            left: 16,
            right: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            pointerEvents: 'none',
            '& > *': { pointerEvents: 'auto', maxWidth: 560 },
          }}
        >
          {audioWarning && (
            <Alert
              severity="warning"
              role="status"
              data-testid="player-no-audio"
              closeText={t.player.dismiss}
              onClose={() => setNoAudio({ ...audioWarning, dismissed: true })}
            >
              {audioWarning.codec !== undefined
                ? t.player.noAudio.codec(formatCodecs(audioWarning.codec))
                : t.player.noAudio.unknown}
            </Alert>
          )}
          {videoWarning && (
            <Alert
              severity="warning"
              role="status"
              data-testid="player-no-video"
              closeText={t.player.dismiss}
              onClose={() => setNoVideo({ ...videoWarning, dismissed: true })}
            >
              {videoWarning.codec !== undefined
                ? t.player.noVideo.codec(formatCodecs(videoWarning.codec))
                : t.player.noVideo.unknown}
            </Alert>
          )}
          {fullscreen.nativeNote && (
            <Alert
              severity="info"
              role="status"
              data-testid="player-native-fullscreen-note"
              closeText={t.player.dismiss}
              onClose={fullscreen.dismissNativeNote}
            >
              {t.player.nativeFullscreenNote}
            </Alert>
          )}
        </Box>
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
          <StateView
            variant="error"
            title={errorText.title}
            message={errorText.message}
            details={error.message}
            actions={
              <>
                <Button variant="contained" onClick={retry}>
                  {t.state.actions.retry}
                </Button>
                {isLive && onNext && (
                  <Button variant="outlined" onClick={onNext}>
                    {t.player.controls.nextChannel}
                  </Button>
                )}
                {errorText.action === 'diagnostics' && (
                  <Button variant="text" component={Link} to={DIAGNOSTICS_PATH}>
                    {t.player.errors.actions.diagnostics}
                  </Button>
                )}
              </>
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
