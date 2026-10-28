import { t } from '@/i18n';

/** Temporary screen until FND-03 (theme and AppShell) and FND-04 (routing). */
export function App() {
  return (
    <main>
      <h1>{t.app.name}</h1>
      <p>{t.app.placeholder}</p>
    </main>
  );
}
