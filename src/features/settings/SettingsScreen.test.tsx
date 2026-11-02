// UX-04 AC1: the Settings sections, in order, with Sources and Privacy links and the theme.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { THEME_CACHE_KEY } from '@/ui/theme/ThemeModeProvider';
import { PrivacyScreen } from './PrivacyScreen';
import { SETTINGS_OPEN_KEY } from './sectionState';
import { SettingsScreen } from './SettingsScreen';
import { expandAllSettingsSections, renderSettings } from './test-utils';

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  expandAllSettingsSections();
  media = installMatchMedia({ width: 1200 });
});
afterEach(async () => {
  localStorage.clear();
  // Unmount first (TEC-03): the setup file's cleanup runs after this hook, and a screen still
  // mounted could re-read state while it is reset below and cache it for the next test.
  cleanup();
  media.restore();
  localStorage.removeItem(THEME_CACHE_KEY);
  await wipeAll();
});

describe('SettingsScreen (UX-04 AC1)', () => {
  it('shows the sections in order: Lists, Appearance, Language, Playback, Parental control, Personal proxy, Backup, Storage, Privacy, About', async () => {
    renderSettings(<SettingsScreen />);
    const s = t.settings.sections;
    expect(
      screen.getByRole('heading', { level: 1, name: t.routes.screens.settings.title }),
    ).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      s.sources,
      s.appearance,
      s.language,
      s.playback,
      t.parental.settings.title,
      s.proxy,
      s.backup,
      s.storage,
      s.privacy,
      s.about,
    ]);
    // Each section is a labelled region.
    for (const name of headings) {
      expect(screen.getByRole('region', { name: name ?? '' })).toBeInTheDocument();
    }
    // Async sections settle without errors.
    await screen.findByRole('switch', { name: t.settings.playback.playLastChannel });
    await screen.findByLabelText(t.settings.proxy.url);
  });

  it('links to My lists and to the Privacy and data page', async () => {
    const user = userEvent.setup();
    const { router } = renderSettings(<SettingsScreen />);
    expect(
      screen.getByRole('link', { name: new RegExp(t.settings.sources.myLists) }),
    ).toHaveAttribute('href', '/settings/sources');
    await user.click(screen.getByRole('link', { name: new RegExp(t.settings.privacy.title) }));
    expect(router.state.location.pathname).toBe('/settings/privacy');
  });

  it('Appearance: choosing a theme applies and saves it', async () => {
    const user = userEvent.setup();
    renderSettings(<SettingsScreen />);
    const group = screen.getByRole('radiogroup', { name: t.settings.appearance.theme });
    expect(within(group).getByRole('radio', { name: t.nav.themes.system })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: t.nav.themes.light }));
    expect(within(group).getByRole('radio', { name: t.nav.themes.light })).toBeChecked();
    await waitFor(async () => expect(await settingsRepo.get('theme')).toBe('light'));
  });
});

describe('PrivacyScreen (UX-04 AC1 — what we store)', () => {
  it('explains what is stored on the device and that nothing is sent to us', () => {
    renderSettings(<PrivacyScreen />);
    const text = t.settings.privacy;
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    expect(screen.getByText(text.storage)).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(Object.values(text.stored));
    expect(screen.getByText(text.notSent)).toBeInTheDocument();
    expect(screen.getByText(text.noChannels)).toBeInTheDocument();
  });
});

describe('SettingsScreen collapsible sections (UX-08)', () => {
  it('starts collapsed, expands on demand and remembers the open sections', async () => {
    localStorage.removeItem(SETTINGS_OPEN_KEY);
    const user = userEvent.setup();
    const s = t.settings.sections;
    renderSettings(<SettingsScreen />);
    const appearance = screen.getByRole('button', { name: s.appearance });
    expect(appearance).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radio', { name: t.nav.themes.dark })).toBeNull();

    await user.click(appearance);
    expect(appearance).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: t.nav.themes.dark })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SETTINGS_OPEN_KEY) ?? '[]')).toEqual(['appearance']);

    // Remembered on the next visit; closing it forgets it again.
    cleanup();
    renderSettings(<SettingsScreen />);
    const again = screen.getByRole('button', { name: s.appearance });
    expect(again).toHaveAttribute('aria-expanded', 'true');
    await user.click(again);
    expect(screen.queryByRole('radio', { name: t.nav.themes.dark })).toBeNull();
    expect(localStorage.getItem(SETTINGS_OPEN_KEY)).toBeNull();
  });
});
