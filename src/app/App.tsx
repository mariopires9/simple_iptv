import { useEffect } from 'react';
import { ToastProvider } from '@/ui/state';
import { ThemeModeProvider } from '@/ui/theme';
import { installChunkReload } from './chunkReload';
import { DatabaseUnavailableScreen, useDatabaseCheck } from './DatabaseUnavailableScreen';
import { AppRouter, getAppRouter } from './router';

/**
 * Theme and toasts (UX-02), then the start-up storage check, then the hash router (AppShell + lazy screens).
 * While the check runs nothing but the themed background is shown (UX_UI §5: short loads do not
 * flash a spinner); it normally takes one IndexedDB open.
 */
export function App() {
  const db = useDatabaseCheck();
  useEffect(() => installChunkReload(), []);

  let content = null;
  if (db.status === 'unavailable') content = <DatabaseUnavailableScreen reason={db.reason} />;
  else if (db.status === 'ready') content = <AppRouter router={getAppRouter()} />;

  return (
    <ThemeModeProvider>
      <ToastProvider>{content}</ToastProvider>
    </ThemeModeProvider>
  );
}
