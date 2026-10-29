// Home (FAV-03, docs/UX_UI.md §3): "Continue watching", "Recent channels" and "Favorites" of the
// active list, each hidden when empty; shortcuts to Live/Movies/Series when there is nothing yet.
// "Clear history" (FAV-02 AC3) removes the list's history after a confirmation.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { t } from '@/i18n';
import {
  DelayedLoading,
  PosterGridSkeleton,
  StateView,
  errorDetails,
  visuallyHidden,
} from '@/ui/state';
import { ClearHistoryDialog } from './ClearHistoryDialog';
import { clearHistory, loadHome } from './data';
import { Shelf } from './Shelf';
import { useListData } from './useListData';

/** "See all" of the recent channels: the Live "Recent" category (features/live virtual id). */
const RECENT_CHANNELS_HREF = '/live/category/~recent';

export function HomeScreen() {
  const { state, reload } = useListData(loadHome);
  const text = t.favorites;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  /** The button is gone after clearing: focus goes to the heading when the dialog has closed. */
  const cleared = useRef(false);

  const sourceId = state.status === 'ready' ? state.sourceId : undefined;
  const confirmClear = useCallback(() => {
    if (sourceId === undefined) return;
    setBusy(true);
    clearHistory(sourceId).then(
      () => {
        cleared.current = true;
        setAnnouncement(text.clearHistory.done);
        setBusy(false);
        setConfirming(false);
        reload();
      },
      () => {
        setAnnouncement(text.clearHistory.failed);
        setBusy(false);
        setConfirming(false);
      },
    );
  }, [sourceId, reload, text]);

  let body;
  if (state.status === 'loading') {
    body = (
      <DelayedLoading>
        <PosterGridSkeleton count={6} />
      </DelayedLoading>
    );
  } else if (state.status === 'error') {
    body = (
      <StateView
        variant="error"
        title={text.loadError.title}
        message={text.loadError.message}
        details={errorDetails(state.error)}
        actions={
          <Button variant="contained" onClick={reload}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else {
    const data = state.status === 'ready' ? state.data : undefined;
    const empty =
      !data ||
      (data.continueWatching.length === 0 &&
        data.recentChannels.length === 0 &&
        data.favorites.length === 0);
    body = (
      <>
        {empty ? (
          <StateView
            variant="empty"
            title={text.empty.title}
            message={text.empty.message}
            actions={
              <>
                <Button variant="contained" component={Link} to="/live">
                  {text.empty.live}
                </Button>
                <Button variant="outlined" component={Link} to="/movies">
                  {text.empty.movies}
                </Button>
                <Button variant="outlined" component={Link} to="/series">
                  {text.empty.series}
                </Button>
              </>
            }
          />
        ) : (
          <>
            {data.continueWatching.length > 0 && (
              <Shelf title={text.sections.continueWatching} items={data.continueWatching} />
            )}
            {data.recentChannels.length > 0 && (
              <Shelf
                title={text.sections.recentChannels}
                items={data.recentChannels}
                seeAllHref={RECENT_CHANNELS_HREF}
              />
            )}
            {data.favorites.length > 0 && (
              <Shelf
                title={text.sections.favorites}
                items={data.favorites}
                seeAllHref="/favorites"
              />
            )}
          </>
        )}
        {data?.hasHistory && (
          <Box sx={{ mt: 2 }}>
            <Button color="error" variant="outlined" onClick={() => setConfirming(true)}>
              {text.clearHistory.button}
            </Button>
          </Box>
        )}
      </>
    );
  }

  return (
    <>
      <Typography
        ref={headingRef}
        variant="h3"
        component="h1"
        tabIndex={-1}
        sx={{ mb: 3, outline: 'none' }}
      >
        {t.routes.screens.home.title}
      </Typography>
      {body}
      <ClearHistoryDialog
        open={confirming}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmClear}
        onExited={() => {
          if (!cleared.current) return;
          cleared.current = false;
          headingRef.current?.focus();
        }}
      />
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </>
  );
}
