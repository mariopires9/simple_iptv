import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): Home (continue watching, recent channels, favorites). */
export function HomeScreen() {
  const text = t.routes.screens.home;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
