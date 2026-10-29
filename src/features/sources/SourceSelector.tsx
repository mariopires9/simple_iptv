// Active list selector in the top bar (SRC-08, docs/UX_UI.md §3): a compact button with the
// active list's name opening a menu — the lists as radio items, then "Manage lists…" and
// "Add list". Switching is instant (the data is already on the device); screens showing items of
// the previous list go back to their section root. Loaded lazily by `SourceSelectorSlot`.
// Hidden while the app does not know of any list: it shares the onboarding guard's cached
// "has sources?" read (one IndexedDB read for both) and only then reads the lists.
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { useToast } from '@/ui/state';
import { setActiveSource, useActiveSource } from './activeSource';
import { AddListDialog } from './AddListDialog';
import { effectiveActiveId, reloadSources, sortSources, useSourcesList } from './sourcesList';
import {
  getSourcesPresenceSnapshot,
  getSourcesPresent,
  hasSources,
  subscribeSourcesPresent,
} from './sourcesPresence';

export const MY_LISTS_PATH = '/settings/sources';

/** Sections whose sub-routes and query (`?channel=`) name items of one list. */
const SOURCE_SCOPED_SECTIONS = new Set(['live', 'movies', 'series']);

/**
 * Where to go after switching lists: a category or item of the previous list (e.g.
 * `/live/category/12?channel=…`) → its section root (`/live`); anything else stays.
 */
export function pathAfterSwitch(pathname: string, search: string): string | undefined {
  const segments = pathname.split('/').filter((s) => s !== '');
  const section = segments[0]?.toLowerCase();
  if (section === undefined || !SOURCE_SCOPED_SECTIONS.has(section)) return undefined;
  if (segments.length === 1 && search === '') return undefined;
  return `/${section}`;
}

export function SourceSelector() {
  const presence = useSyncExternalStore(subscribeSourcesPresent, getSourcesPresenceSnapshot);
  const present = presence.present === true;
  const { sources } = useSourcesList(present);
  const active = useActiveSource();
  // Settings pages are not guarded: ask once on mount if nobody has yet (later changes are
  // published by whoever adds or removes a list).
  useEffect(() => {
    if (getSourcesPresent() === undefined) hasSources().catch(() => undefined);
  }, []);
  // A read once lists exist (the cached list may predate a change in another screen); joins a
  // read already in flight (e.g. My lists opening at the same time).
  useEffect(() => {
    if (present) reloadSources('shared').catch(() => undefined);
  }, [present]);

  if (!present || sources === undefined || !active.known) return null;
  return <SelectorMenu sources={sources} activeId={effectiveActiveId(sources, active.id)} />;
}

function SelectorMenu({
  sources,
  activeId,
}: {
  sources: readonly Source[];
  activeId: string | undefined;
}) {
  const text = t.lists.selector;
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [adding, setAdding] = useState(false);
  const buttonId = useId();
  const menuId = useId();
  const ordered = sortSources(sources, activeId);
  const current = ordered.find((s) => s.id === activeId);
  const close = () => setAnchor(null);

  async function choose(id: string) {
    close();
    if (id === activeId) return;
    // Switch first; leave items of the previous list only once the switch has happened.
    const target = pathAfterSwitch(location.pathname, location.search);
    try {
      await setActiveSource(id);
    } catch (error) {
      log.warn('Switching the active source failed', { error });
      toast.show({ message: t.lists.switchFailed, severity: 'error' });
      return;
    }
    if (target !== undefined) void navigate(target, { replace: true });
  }

  return (
    <>
      <Button
        id={buttonId}
        color="inherit"
        aria-label={current ? text.label(current.name) : text.noneLabel}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? true : undefined}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          // Counts or names may have changed (sync, another tab): refresh in the background.
          reloadSources('shared').catch(() => undefined);
        }}
        endIcon={<ArrowDropDownRounded />}
        sx={{ minWidth: 0, maxWidth: '100%', minHeight: 44, textTransform: 'none' }}
      >
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
        >
          {current?.name ?? text.none}
        </Box>
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': buttonId } }}
      >
        {ordered.map((source) => (
          <MenuItem
            key={source.id}
            role="menuitemradio"
            aria-checked={source.id === activeId}
            onClick={() => void choose(source.id)}
            sx={{ maxWidth: 360 }}
          >
            <ListItemIcon>{source.id === activeId && <CheckRounded />}</ListItemIcon>
            <ListItemText slotProps={{ primary: { noWrap: true } }}>{source.name}</ListItemText>
          </MenuItem>
        ))}
        {ordered.length > 0 && <Divider />}
        <MenuItem component={Link} to={MY_LISTS_PATH} onClick={close}>
          <ListItemIcon>
            <TuneRounded />
          </ListItemIcon>
          <ListItemText>{text.manage}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setAdding(true);
          }}
        >
          <ListItemIcon>
            <AddRounded />
          </ListItemIcon>
          <ListItemText>{text.add}</ListItemText>
        </MenuItem>
      </Menu>
      <AddListDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
