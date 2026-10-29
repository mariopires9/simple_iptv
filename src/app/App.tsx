import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import {
  activeLocale,
  applyPendingLocale,
  installLanguagePreference,
  restoreLanguagePreference,
  subscribeLocale,
} from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installChunkReload } from './chunkReload';
import { DatabaseUnavailableScreen, useDatabaseCheck } from './DatabaseUnavailableScreen';
import { AppRouter, getAppRouter } from './router';

/** The stored interface language is applied before the router's first render (UX-06). */
function useLanguageRestored(): boolean {
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let active = true;
    void restoreLanguagePreference().finally(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return restored;
}

/**
 * Theme and toasts (UX-02), then the start-up storage check, then the hash router (AppShell + lazy screens).
 * While the check runs nothing but the themed background is shown (UX_UI §5: short loads do not
 * flash a spinner); it normally takes one IndexedDB open.
 *
 * Interface language (UX-06): screens read `t` while rendering, so a locale switch re-mounts the
 * routed content (keyed by locale) and every visible string changes at once, without a reload.
 * The router is a singleton, so the current route is kept; theme and toasts stay mounted. A
 * re-mount only ever follows the user's own choice in Settings: the stored language is applied
 * before the first render, and a browser language change (preference `system`) waits for the next
 * navigation with no player mounted (`applyPendingLocale`), so it never tears down playback or a
 * form being filled in.
 */
export function App() {
  const db = useDatabaseCheck();
  const languageRestored = useLanguageRestored();
  const locale = useSyncExternalStore(subscribeLocale, activeLocale);
  useEffect(() => installChunkReload(), []);
  useEffect(() => installLanguagePreference(), []);

  const routerReady = db.status === 'ready' && languageRestored;
  useEffect(() => {
    if (!routerReady) return undefined;
    const router = getAppRouter();
    let location = router.state.location;
    return router.subscribe((state) => {
      if (state.location === location) return;
      location = state.location;
      applyPendingLocale();
    });
  }, [routerReady]);

  let content = null;
  if (db.status === 'unavailable') content = <DatabaseUnavailableScreen reason={db.reason} />;
  else if (routerReady) content = <AppRouter router={getAppRouter()} />;

  return (
    <ThemeModeProvider>
      <ToastProvider>
        <Fragment key={locale}>{content}</Fragment>
      </ToastProvider>
    </ThemeModeProvider>
  );
}
