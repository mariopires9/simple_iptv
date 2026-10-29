// UX-06 AC2/AC3 (component test): Settings › Language switches every visible string at once —
// shell and screen — without a reload, keeps the route and the focus, updates <html lang> and
// persists the choice.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import { resetLanguagePreferenceForTests, setLocale, t } from '@/i18n';
import { messages } from '@/i18n/catalogs';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { App } from './App';
import { getAppRouter, resetAppRouter } from './router';

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  setSourcesPresent(true);
  media = installMatchMedia({ width: 1400 });
});

afterEach(async () => {
  invalidateSourcesPresence();
  resetAppRouter();
  media.restore();
  window.location.hash = '';
  resetLanguagePreferenceForTests();
  await setLocale('en');
  await wipeAll();
});

describe('UX-06 — switching the interface language in Settings', () => {
  it('Português: every visible text switches immediately, route and focus kept, choice saved', async () => {
    const en = messages('en');
    const pt = messages('pt-PT');
    const user = userEvent.setup();
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: en.routes.screens.settings.title });
    expect(screen.getByRole('navigation', { name: en.nav.mainNavigation })).toBeInTheDocument();
    const reloads = performance.getEntriesByType('navigation').length;

    await user.click(screen.getByRole('radio', { name: en.settings.language.names['pt-PT'] }));

    // Screen and shell, eager and lazy strings alike.
    await screen.findByRole('heading', { level: 1, name: pt.routes.screens.settings.title });
    expect(
      screen.getByRole('heading', { level: 2, name: pt.settings.sections.playback }),
    ).toBeVisible();
    expect(screen.getByRole('navigation', { name: pt.nav.mainNavigation })).toBeInTheDocument();
    expect(screen.queryByText(en.settings.sections.playback)).toBeNull();
    expect(document.documentElement.lang).toBe('pt-PT');
    expect(t.settings.sections.about).toBe(pt.settings.sections.about);
    // No reload, same route; the chosen option keeps the focus after the re-render.
    expect(performance.getEntriesByType('navigation')).toHaveLength(reloads);
    expect(getAppRouter().state.location.pathname).toBe('/settings');
    const chosen = screen.getByRole('radio', { name: pt.settings.language.names['pt-PT'] });
    expect(chosen).toBeChecked();
    await waitFor(() => expect(chosen).toHaveFocus());
    await waitFor(async () => expect(await settingsRepo.get('locale')).toBe('pt-PT'));

    // And back.
    await user.click(screen.getByRole('radio', { name: pt.settings.language.names.en }));
    await screen.findByRole('heading', { level: 1, name: en.routes.screens.settings.title });
    expect(document.documentElement.lang).toBe('en');
    await waitFor(async () => expect(await settingsRepo.get('locale')).toBe('en'));
  });

  it('a stored language is applied at start-up', async () => {
    await settingsRepo.set('locale', 'pt-PT');
    window.location.hash = '#/settings';
    render(<App />);
    await screen.findByRole('heading', {
      level: 1,
      name: messages('pt-PT').routes.screens.settings.title,
    });
    expect(document.documentElement.lang).toBe('pt-PT');
    expect(
      screen.getByRole('radio', { name: messages('pt-PT').settings.language.names['pt-PT'] }),
    ).toBeChecked();
  });

  it('"System" names the language it resolves to', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    const en = messages('en').settings.language;
    expect(await screen.findByRole('radio', { name: en.system(en.names.en) })).toBeChecked();
  });
});
