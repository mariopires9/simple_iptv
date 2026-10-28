// "Channels" panel over the player (LIV-02 AC4, docs/UX_UI.md §4.5): pick another channel of the
// current category without leaving the player. Opened by the player's channel-list button or `L`;
// closed by Esc, the close button or picking a channel. TODO(PLY-03): the same panel in fullscreen.
import CloseRounded from '@mui/icons-material/CloseRounded';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useMemo, type KeyboardEvent } from 'react';
import type { Channel } from '@/core/db';
import { t } from '@/i18n';
import { ChannelList } from './ChannelList';
import { PageCache } from './pageCache';
import type { ChannelPager } from './pagers';

export interface ChannelsOverlayProps {
  /** The category's pager (the panel keeps its own page cache over it). */
  pager: ChannelPager;
  categoryName: string;
  favorites: ReadonlySet<string>;
  playingKey: string | undefined;
  /** Row of the playing channel, when known: the list opens there. */
  playingIndex: number | undefined;
  onPlay: (channel: Channel, index: number) => void;
  onToggleFavorite: (channel: Channel) => void;
  onClose: () => void;
}

export function ChannelsOverlay({
  pager,
  categoryName,
  favorites,
  playingKey,
  playingIndex,
  onPlay,
  onToggleFavorite,
  onClose,
}: ChannelsOverlayProps) {
  // A ChannelList owns its cache's subscription, so the panel cannot share the main list's one.
  const cache = useMemo(() => new PageCache(pager), [pager]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <Box
      role="dialog"
      aria-label={t.live.player.channels}
      onKeyDown={onKeyDown}
      data-testid="channels-overlay"
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(360px, 100%)',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: 8,
        zIndex: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 0.5, py: 0.5 }}>
        <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }} noWrap>
          {t.live.player.channels}
        </Typography>
        <IconButton
          aria-label={t.live.player.closeChannels}
          onClick={onClose}
          sx={{ width: 44, height: 44 }}
        >
          <CloseRounded />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ChannelList
          cache={cache}
          label={t.live.channelsIn(categoryName)}
          favorites={favorites}
          playingKey={playingKey}
          onPlay={onPlay}
          onToggleFavorite={onToggleFavorite}
          initialIndex={playingIndex}
          focusOnMount
        />
      </Box>
    </Box>
  );
}
