import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): settings. */
export function SettingsScreen() {
  const text = t.routes.screens.settings;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
