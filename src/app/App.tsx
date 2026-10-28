import { t } from '@/i18n';

/** Ecrã provisório até FND-03 (tema e AppShell) e FND-04 (routing). */
export function App() {
  return (
    <main>
      <h1>{t.app.name}</h1>
      <p>{t.app.placeholder}</p>
    </main>
  );
}
