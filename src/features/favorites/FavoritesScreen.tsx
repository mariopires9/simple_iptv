// Favorites (FAV-01, FAV-03 AC2): tabs Channels / Movies / Series with the active list's
// favorites. A favorite whose item left the list (re-sync) is shown as "Unavailable" with a
// Remove button (FAV-01 AC2). The tab is in the URL (`?tab=movies`), so it survives a reload.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useCallback, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ContentType } from '@/core/db';
import { t } from '@/i18n';
import {
  DelayedLoading,
  PosterGridSkeleton,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { radii } from '@/ui/theme/tokens';
import { loadFavorites, removeFavorite, type FavoriteEntry } from './data';
import { CARD_WIDTH, CardText, ItemCard } from './ItemCard';
import { useListData } from './useListData';

/** URL value of each tab. */
const TABS: readonly { type: ContentType; param: string }[] = [
  { type: 'live', param: 'channels' },
  { type: 'movie', param: 'movies' },
  { type: 'series', param: 'series' },
];

const BROWSE_HREF: Readonly<Record<ContentType, string>> = {
  live: '/live',
  movie: '/movies',
  series: '/series',
};

function tabOf(param: string | null): ContentType {
  return TABS.find((tab) => tab.param === param)?.type ?? 'live';
}

export function FavoritesScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = tabOf(searchParams.get('tab'));
  const load = useCallback((sourceId: string) => loadFavorites(sourceId, type), [type]);
  const { state, reload } = useListData(load, type);
  const text = t.favorites.screen;
  const baseId = useId();
  const [announcement, setAnnouncement] = useState('');
  /** Removed keys, hidden at once (optimistic) until the reload confirms it. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  const selectTab = (next: ContentType) => {
    const param = TABS.find((tab) => tab.type === next)?.param ?? 'channels';
    setSearchParams({ tab: param }, { replace: true });
  };

  const remove = (entry: FavoriteEntry) => {
    const key = entry.favorite.itemKey;
    setRemoved((prev) => new Set(prev).add(key));
    setAnnouncement(entry.card ? text.removed(entry.card.name) : text.removedUnavailable);
    removeFavorite(key).then(reload, () => {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setAnnouncement(text.removeFailed);
    });
  };

  let panel;
  if (state.status === 'loading') {
    panel = (
      <DelayedLoading>
        <PosterGridSkeleton count={6} />
      </DelayedLoading>
    );
  } else if (state.status === 'error') {
    panel = (
      <StateView
        variant="error"
        title={t.favorites.loadError.title}
        message={t.favorites.loadError.message}
        details={errorDetails(state.error)}
        actions={
          <Button variant="contained" onClick={reload}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else {
    const entries =
      state.status === 'ready' ? state.data.filter((e) => !removed.has(e.favorite.itemKey)) : [];
    panel =
      entries.length === 0 ? (
        <StateView
          variant="empty"
          title={text.empty[type]}
          message={text.emptyHint}
          actions={
            <Button variant="contained" component={Link} to={BROWSE_HREF[type]}>
              {text.browse[type]}
            </Button>
          }
        />
      ) : (
        <Box
          component="ul"
          role="list"
          aria-label={text.tabs[type]}
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: `repeat(auto-fill, minmax(${CARD_WIDTH.xs}px, 1fr))`,
              sm: `repeat(auto-fill, minmax(${CARD_WIDTH.sm}px, 1fr))`,
              md: `repeat(auto-fill, minmax(${CARD_WIDTH.md}px, 1fr))`,
            },
          }}
        >
          {entries.map((entry) => (
            <Box component="li" key={entry.favorite.itemKey} sx={{ minWidth: 0 }}>
              <FavoriteCell entry={entry} type={type} onRemove={() => remove(entry)} />
            </Box>
          ))}
        </Box>
      );
  }

  return (
    <>
      <Typography variant="h3" component="h1" sx={{ mb: 2 }}>
        {t.routes.screens.favorites.title}
      </Typography>
      <Tabs
        value={type}
        onChange={(_event, value: ContentType) => selectTab(value)}
        aria-label={text.tabsLabel}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 3 }}
      >
        {TABS.map((tab) => (
          <Tab
            key={tab.type}
            value={tab.type}
            label={text.tabs[tab.type]}
            id={`${baseId}-tab-${tab.type}`}
            aria-controls={`${baseId}-panel`}
          />
        ))}
      </Tabs>
      <Box role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${type}`}>
        {panel}
      </Box>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </>
  );
}

function FavoriteCell({
  entry,
  type,
  onRemove,
}: {
  entry: FavoriteEntry;
  type: ContentType;
  onRemove: () => void;
}) {
  const text = t.favorites.screen;
  const { card } = entry;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {card ? (
        <ItemCard item={card} />
      ) : (
        <Box data-testid="unavailable-favorite">
          <Box
            aria-hidden="true"
            sx={{
              width: '100%',
              aspectRatio: type === 'live' ? '1 / 1' : '2 / 3',
              borderRadius: `${radii.md}px`,
              bgcolor: 'tokens.surface2',
              border: '1px dashed',
              borderColor: 'divider',
            }}
          />
          <CardText name={text.unavailable} secondary={text.unavailableHint} />
        </Box>
      )}
      <Button
        size="small"
        onClick={onRemove}
        aria-label={card ? text.removeLabel(card.name) : text.removeUnavailableLabel}
        sx={{ mt: 0.5, alignSelf: 'flex-start', minHeight: 44 }}
      >
        {text.remove}
      </Button>
    </Box>
  );
}
