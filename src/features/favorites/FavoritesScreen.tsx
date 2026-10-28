import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): favorites. */
export function FavoritesScreen() {
  const text = t.routes.screens.favorites;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
