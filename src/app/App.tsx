import { useState } from 'react';
import { ThemeModeProvider } from '@/ui/theme';
import { DatabaseUnavailableScreen, useDatabaseCheck } from './DatabaseUnavailableScreen';
import { AppRouter, createAppRouter } from './router';

/** Theme + hash router (AppShell and lazy screens), or a full-screen message without storage. */
export function App() {
  // One router for the app's lifetime, created on first render (it reads `window.location`).
  const [router] = useState(createAppRouter);
  const dbUnavailable = useDatabaseCheck();

  return (
    <ThemeModeProvider>
      {dbUnavailable ? (
        <DatabaseUnavailableScreen reason={dbUnavailable} />
      ) : (
        <AppRouter router={router} />
      )}
    </ThemeModeProvider>
  );
}
