import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): "My lists" page (manage IPTV lists). */
export function SourcesScreen() {
  const text = t.routes.screens.sources;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
