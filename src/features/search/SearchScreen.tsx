import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): global search. */
export function SearchScreen() {
  const text = t.routes.screens.search;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
