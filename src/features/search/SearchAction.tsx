// Top-bar search entry point (SCH-02 AC1): the search icon and the `/` shortcut open `/search`
// with the focus in the field. Part of the initial bundle (the top bar is always mounted): eager
// strings only (`nav.search`), no Dexie, no worker.
import SearchRounded from '@mui/icons-material/SearchRounded';
import IconButton from '@mui/material/IconButton';
import { useEffect, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { t } from '@/i18n';

export const SEARCH_PATH = '/search';
/** Id of the search field on the search screen (focused by the shortcut when already there). */
export const SEARCH_INPUT_ID = 'global-search-input';

/** Whether a key press there types text (or belongs to a dialog) rather than being a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('input, textarea, select, [role="dialog"], [role="textbox"]')) return true;
  return false;
}

export function SearchAction() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onSearchScreen = pathname === SEARCH_PATH;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      const field = document.getElementById(SEARCH_INPUT_ID);
      if (onSearchScreen && field) field.focus();
      else navigate(SEARCH_PATH);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, onSearchScreen]);

  const onClick = (event: MouseEvent) => {
    // Already searching: the icon only brings the focus back to the field.
    const field = document.getElementById(SEARCH_INPUT_ID);
    if (onSearchScreen && field) {
      event.preventDefault();
      field.focus();
    }
  };

  return (
    <IconButton
      component={Link}
      to={SEARCH_PATH}
      aria-label={t.nav.search}
      aria-keyshortcuts="/"
      aria-current={onSearchScreen ? 'page' : undefined}
      onClick={onClick}
      sx={onSearchScreen ? { color: 'primary.main' } : undefined}
    >
      <SearchRounded />
    </IconButton>
  );
}
