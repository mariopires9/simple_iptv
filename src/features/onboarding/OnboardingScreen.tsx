import { t } from '@/i18n';
import { PlaceholderScreen } from '@/ui/PlaceholderScreen';

/** Placeholder (FND-04): first-use onboarding (no sources yet). */
export function OnboardingScreen() {
  const text = t.routes.screens.onboarding;
  return <PlaceholderScreen title={text.title} message={text.empty} />;
}
