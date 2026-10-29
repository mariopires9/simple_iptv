import { Fragment, useEffect, useSyncExternalStore } from 'react';
import { activeLocale, installLanguagePreference, subscribeLocale } from '@/i18n';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installChunkReload } from './chunkReload';
import { DatabaseUnavailableScreen, useDatabaseCheck } from './DatabaseUnavailableScreen';
import { AppRouter, getAppRouter } from './router';

/**
 * Theme and toasts (UX-02), then the start-up storage check, then the hash router (AppShell + lazy screens).
 * While the check runs nothing but the themed background is shown (UX_UI §5: short loads do not
 * flash a spinner); it normally takes one IndexedDB open.
 *
 * Interface language (UX-06): screens read `t` while rendering, so a locale switch re-mounts the
 * routed content (keyed by locale) and every visible string changes at once, without a reload.
 * The router is a singleton, so the current route is kept; theme and toasts stay mounted.
 */
export function App() {
  const db = useDatabaseCheck();
  const locale = useSyncExternalStore(subscribeLocale, activeLocale);
  useEffect(() => installChunkReload(), []);
  useEffect(() => installLanguagePreference(), []);

  let content = null;
  if (db.status === 'unavailable') content = <DatabaseUnavailableScreen reason={db.reason} />;
  else if (db.status === 'ready') content = <AppRouter router={getAppRouter()} />;

  return (
    <ThemeModeProvider>
      <ToastProvider>
        <Fragment key={locale}>{content}</Fragment>
      </ToastProvider>
    </ThemeModeProvider>
  );
}
