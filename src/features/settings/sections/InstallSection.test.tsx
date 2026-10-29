// PWA-01 AC3: Settings › Install app, fed by the install prompt store started at boot.
import 'fake-indexeddb/auto';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeAll } from '@/core/db';
import {
  installPromptStore,
  resetInstallPromptStoreForTests,
  type BeforeInstallPromptEvent,
} from '@/core/platform';
import { isMessagesLoaded, loadAllMessages, t, unloadMessagesForTests } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { settingsRoutes } from '../routes';
import { SettingsScreen } from '../SettingsScreen';
import { renderSettings } from '../test-utils';

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
  installPromptStore(); // src/main.tsx starts it at boot
});
afterEach(async () => {
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  resetInstallPromptStoreForTests();
  media.restore();
  await wipeAll();
});

function installEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });
  return { event, prompt };
}

describe('Settings › Install app (PWA-01 AC3)', () => {
  it('eligible Chrome/Edge: the event fired at boot, Settings opened later shows the button', async () => {
    const { event, prompt } = installEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // no mini-infobar: Settings offers it instead

    const user = userEvent.setup();
    renderSettings(<SettingsScreen />);
    const region = screen.getByRole('region', { name: t.install.title });
    expect(within(region).getByRole('heading', { level: 2, name: t.install.title })).toBeVisible();

    await user.click(within(region).getByRole('button', { name: t.install.button }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await within(region).findByText(t.install.installed)).toBeInTheDocument();
  });

  it('comes after Storage and before Privacy', () => {
    window.dispatchEvent(installEvent().event);
    renderSettings(<SettingsScreen />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    const s = t.settings.sections;
    expect(headings.indexOf(t.install.title)).toBe(headings.indexOf(s.storage) + 1);
    expect(headings.indexOf(s.privacy)).toBe(headings.indexOf(t.install.title) + 1);
  });

  it('no install prompt (e.g. Firefox): no Install section', () => {
    renderSettings(<SettingsScreen />);
    expect(screen.queryByRole('heading', { name: t.install.title })).toBeNull();
  });

  it('the Settings route loads the install strings with the screen', async () => {
    unloadMessagesForTests();
    try {
      const lazy = settingsRoutes.find((r) => r.path === 'settings')?.lazy;
      expect(typeof lazy).toBe('function');
      await (lazy as () => Promise<unknown>)();
      expect(isMessagesLoaded('install')).toBe(true);
      expect(isMessagesLoaded('settings')).toBe(true);
    } finally {
      await loadAllMessages();
    }
  });
});
