import { InstallAppSection } from '@/ui/pwa';
import { SettingsSection } from '../SettingsSection';

/**
 * Settings › Install app (PWA-01 AC3): the install button (Chrome/Edge), the "Share → Add to Home
 * Screen" steps (iOS) or the installed status. Hidden where the browser offers no install prompt.
 */
export function InstallSection() {
  return (
    <InstallAppSection
      renderSection={(title, content) => <SettingsSection title={title}>{content}</SettingsSection>}
    />
  );
}
