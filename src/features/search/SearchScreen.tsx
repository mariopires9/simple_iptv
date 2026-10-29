// Global search (SCH-02): one field over the active list's channels, movies and series.
//
// - The field has the focus on open (`/` or the top-bar icon, SearchAction.tsx).
// - From 2 letters/digits, results grouped by type (20 per group + "see all"), 120 ms after the
//   last keystroke; queries run in the data worker (SCH-01) and a newer query aborts the older.
// - A result opens: channel → Live (its category, playing it), movie/series → details.
// - The last 10 searches are kept on this device (Enter or opening a result), with "Clear".
// - Switching the active list re-runs the query against the new list.
// - Accessibility: a search landmark, one heading per group, results announced politely.
// The query lives in the URL (`?q=`, `&type=` for "see all"), so going back restores the results.
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LiveTvRounded from '@mui/icons-material/LiveTvRounded';
import MovieRounded from '@mui/icons-material/MovieRounded';
import VideoLibraryRounded from '@mui/icons-material/VideoLibraryRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router';
import { CONTENT_TYPES, isContentType, isSearchableQuery, type ContentType } from '@/core/db';
import { t } from '@/i18n';
import { DelayedLoading, StateView, errorDetails, visuallyHidden } from '@/ui/state';
import type { SearchHit, SearchQueryResult } from '@/worker';
import { resultPath } from './paths';
import { useActiveSource } from '@/ui/hooks/useActiveSource';
import { GROUP_LIMIT, SEARCH_DEBOUNCE_MS, SEE_ALL_LIMIT } from './query';
import { loadRecentSearches, updateRecentSearches, withRecentSearch } from './recentSearches';
import { SEARCH_INPUT_ID } from './SearchAction';
import { searchClient } from './searchClient';

const TYPE_ICONS: Record<ContentType, ReactNode> = {
  live: <LiveTvRounded />,
  movie: <MovieRounded />,
  series: <VideoLibraryRounded />,
};

/** `view`: '' for the grouped view, else the type of the "see all" view. */
type ResultState =
  | { key: string; view: string; status: 'ready'; data: SearchQueryResult }
  | { key: string; view: string; status: 'error'; error: unknown };

/** Focusable results, in order (arrow-key navigation). */
const RESULT_SELECTOR = '[data-search-result]';

export function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const typeParam = params.get('type') ?? '';
  const type = isContentType(typeParam) ? typeParam : undefined;

  const [text, setText] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const hintId = useId();

  const active = useActiveSource();
  const sourceId = active.id;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce: the query follows the text 120 ms after the last keystroke.
  useEffect(() => {
    if (text === query) return undefined;
    const timer = setTimeout(() => setQuery(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  // Navigation (back/forward, a link with another `?q=`) changes the URL: the field follows it
  // (state adjusted while rendering; the query's own URL update finds them already equal).
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== query) {
      setText(urlQuery);
      setQuery(urlQuery);
    }
  }

  // The URL follows the query (replace: typing does not add history entries).
  useEffect(() => {
    if ((params.get('q') ?? '') === query) return;
    const next = new URLSearchParams(params);
    if (query === '') next.delete('q');
    else next.set('q', query);
    setParams(next, { replace: true });
    // Only the query drives this; `params` is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Load the index into the worker's memory as soon as the screen opens (SCH-01 AC2).
  useEffect(() => {
    if (sourceId !== undefined) searchClient.warmUp(sourceId);
  }, [sourceId]);

  // --- recent searches ------------------------------------------------------------------------
  // Shown optimistically; every change is a queued read-modify-write of the stored list
  // (recentSearches.ts), and only the answer to the latest operation is applied, so a slow first
  // read never overwrites a newer change.
  const [recent, setRecent] = useState<string[]>([]);
  const latestRecentOp = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const applyRecent = (operation: Promise<string[]>) => {
    const op = ++latestRecentOp.current;
    operation.then(
      (list) => {
        if (mounted.current && op === latestRecentOp.current) setRecent(list);
      },
      () => undefined,
    );
  };
  useEffect(() => {
    applyRecent(loadRecentSearches());
  }, []);
  const remember = (q: string) => {
    if (!isSearchableQuery(q)) return;
    setRecent((list) => withRecentSearch(list, q));
    applyRecent(updateRecentSearches((list) => withRecentSearch(list, q)));
  };
  const runRecent = (q: string) => {
    setText(q);
    setQuery(q);
    remember(q);
    inputRef.current?.focus();
  };
  const clearRecent = () => {
    setRecent([]);
    applyRecent(updateRecentSearches(() => []));
    inputRef.current?.focus();
  };

  // --- results --------------------------------------------------------------------------------
  const [attempt, setAttempt] = useState(0);
  const searchable = isSearchableQuery(query);
  const view = type ?? '';
  const requestKey =
    searchable && sourceId !== undefined
      ? JSON.stringify([sourceId, query, type ?? '', attempt])
      : '';
  const [result, setResult] = useState<ResultState>();
  useEffect(() => {
    if (requestKey === '' || sourceId === undefined) return undefined;
    const controller = new AbortController();
    const key = requestKey;
    const forView = view;
    const request = { sourceId, query, limit: type ? SEE_ALL_LIMIT : GROUP_LIMIT };
    searchClient.query(type ? { ...request, type } : request, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, view: forView, status: 'ready', data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, view: forView, status: 'error', error });
      },
    );
    return () => controller.abort();
    // `requestKey` encodes source, query, type and attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = result?.key === requestKey ? result : undefined;
  // While a newer query runs, the previous results of the same list and view stay on screen
  // (never results of the grouped view on a "see all" view, or the other way round).
  const shown =
    current ??
    (result?.status === 'ready' && result.data.sourceId === sourceId && result.view === view
      ? result
      : undefined);
  const loading = requestKey !== '' && current === undefined;
  const ready = shown?.status === 'ready' ? shown.data : undefined;
  const total = ready ? CONTENT_TYPES.reduce((n, k) => n + ready.groups[k].total, 0) : 0;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(text);
    remember(text);
  };

  const focusResult = (offset: 1 | -1) => {
    const items = [...(resultsRef.current?.querySelectorAll<HTMLElement>(RESULT_SELECTOR) ?? [])];
    if (items.length === 0) return;
    const index = items.findIndex((el) => el === document.activeElement);
    if (index === -1) {
      items[0]?.focus();
      return;
    }
    const next = index + offset;
    if (next < 0) inputRef.current?.focus();
    else items[Math.min(next, items.length - 1)]?.focus();
  };
  const onFieldKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResult(1);
    }
  };
  const onResultsKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!(event.target instanceof HTMLElement) || !event.target.matches(RESULT_SELECTOR)) return;
    event.preventDefault();
    focusResult(event.key === 'ArrowDown' ? 1 : -1);
  };

  const pathWith = (q: string, k?: ContentType) => {
    const next = new URLSearchParams({ q });
    if (k) next.set('type', k);
    return `?${next.toString()}`;
  };

  let content: ReactNode;
  if (active.known && sourceId === undefined) {
    content = (
      <StateView
        variant="empty"
        title={t.search.noList.title}
        message={t.search.noList.message}
        actions={
          <Button variant="contained" component={Link} to="/settings/sources">
            {t.search.noList.action}
          </Button>
        }
      />
    );
  } else if (!searchable) {
    content = (
      <RecentSearches recent={recent} onPick={runRecent} onClear={clearRecent} hintId={hintId} />
    );
  } else if (shown?.status === 'error') {
    content = (
      <StateView
        variant="error"
        title={t.search.error.title}
        message={t.search.error.message}
        details={errorDetails(shown.error)}
        actions={
          <Button variant="contained" onClick={() => setAttempt((n) => n + 1)}>
            {t.state.actions.retry}
          </Button>
        }
      />
    );
  } else if (ready && total === 0) {
    content = (
      <StateView
        variant="no-results"
        title={t.search.noResults.title}
        message={t.search.noResults.message(ready.query)}
      />
    );
  } else if (ready) {
    const types = type ? [type] : CONTENT_TYPES.filter((k) => ready.groups[k].total > 0);
    content = (
      <Stack spacing={3}>
        {type && (
          <Box>
            <Button component={Link} to={pathWith(query)} replace>
              {t.search.allResults}
            </Button>
          </Box>
        )}
        {types.map((k) => (
          <ResultGroup
            key={k}
            type={k}
            hits={ready.groups[k].hits}
            total={ready.groups[k].total}
            seeAll={type ? undefined : pathWith(query, k)}
            onOpen={() => remember(ready.query)}
          />
        ))}
      </Stack>
    );
  } else {
    content = null;
  }

  return (
    <Box>
      <Typography id={headingId} variant="h3" component="h1" sx={{ mb: 2 }}>
        {t.search.title}
      </Typography>
      <Box
        component="form"
        role="search"
        aria-labelledby={headingId}
        onSubmit={onSubmit}
        sx={{ maxWidth: 720, mb: 2 }}
      >
        <TextField
          id={SEARCH_INPUT_ID}
          inputRef={inputRef}
          type="search"
          fullWidth
          label={t.search.fieldLabel}
          placeholder={t.search.placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onFieldKeyDown}
          autoComplete="off"
          slotProps={{
            htmlInput: {
              enterKeyHint: 'search',
              maxLength: 200,
              'aria-describedby': searchable ? undefined : hintId,
            },
          }}
        />
      </Box>
      <Box sx={{ height: 4, mb: 1 }}>
        <DelayedLoading loading={loading}>
          <LinearProgress aria-hidden />
        </DelayedLoading>
      </Box>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {current?.status === 'ready' ? t.search.announce(total) : ''}
      </Box>
      <Box ref={resultsRef} onKeyDown={onResultsKeyDown} aria-busy={loading || undefined}>
        {content}
      </Box>
    </Box>
  );
}

interface ResultGroupProps {
  type: ContentType;
  hits: readonly SearchHit[];
  total: number;
  /** Link to this type's "see all" view (grouped view only). */
  seeAll: string | undefined;
  onOpen: () => void;
}

function ResultGroup({ type, hits, total, seeAll, onOpen }: ResultGroupProps) {
  const headingId = useId();
  const name = t.search.groups[type];
  return (
    <Box component="section" aria-labelledby={headingId}>
      <Typography id={headingId} variant="h4" component="h2" sx={{ mb: 1 }}>
        {t.search.groupHeading(name, total)}
      </Typography>
      <List dense disablePadding aria-labelledby={headingId}>
        {hits.map((hit) => (
          <ListItem key={hit.key} disablePadding>
            <ListItemButton
              component={Link}
              to={resultPath(hit)}
              onClick={onOpen}
              data-search-result=""
            >
              <ListItemIcon aria-hidden>{TYPE_ICONS[type]}</ListItemIcon>
              <ListItemText primary={hit.name} secondary={secondaryText(hit) || undefined} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      {seeAll !== undefined && total > hits.length && (
        <Button component={Link} to={seeAll} sx={{ mt: 1 }}>
          {t.search.seeAll(name, total)}
        </Button>
      )}
      {seeAll === undefined && total > hits.length && (
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t.search.showingFirst(hits.length, total)}
        </Typography>
      )}
    </Box>
  );
}

function secondaryText(hit: SearchHit): string {
  const parts: string[] = [];
  if (hit.number !== undefined) parts.push(t.search.channelNumber(hit.number));
  if (hit.year !== undefined) parts.push(String(hit.year));
  if (hit.categoryName) parts.push(hit.categoryName);
  return parts.join(' · ');
}

interface RecentSearchesProps {
  recent: readonly string[];
  onPick: (query: string) => void;
  onClear: () => void;
  hintId: string;
}

function RecentSearches({ recent, onPick, onClear, hintId }: RecentSearchesProps) {
  const headingId = useId();
  return (
    <Box>
      <Typography id={hintId} color="text.secondary" sx={{ mb: 2 }}>
        {t.search.hint}
      </Typography>
      <Box component="section" aria-labelledby={headingId}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography id={headingId} variant="h4" component="h2">
            {t.search.recent.title}
          </Typography>
          {recent.length > 0 && (
            <Button onClick={onClear} aria-label={t.search.recent.clearLabel}>
              {t.search.recent.clear}
            </Button>
          )}
        </Stack>
        {recent.length === 0 ? (
          <Typography color="text.secondary">{t.search.recent.empty}</Typography>
        ) : (
          <List dense disablePadding aria-labelledby={headingId}>
            {recent.map((q) => (
              <ListItem key={q} disablePadding>
                <ListItemButton onClick={() => onPick(q)} data-search-result="">
                  <ListItemIcon aria-hidden>
                    <HistoryRounded />
                  </ListItemIcon>
                  <ListItemText primary={q} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
