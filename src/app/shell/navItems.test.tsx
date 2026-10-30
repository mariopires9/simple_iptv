// UX-06 (QA-02 defect): rail and bottom bar labels follow a language switch without a reload.
// The items are module constants: their labels must be read from `t` at render time.
import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from '@/core/db';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import { resetLanguagePreferenceForTests, setLocale } from '@/i18n';
import { messages } from '@/i18n/catalogs';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { App } from '../App';
import { resetAppRouter } from '../router';
import { PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM } from './navItems';

const en = messages('en');
const pt = messages('pt-PT');
const PRIMARY = ['home', 'live', 'movies', 'series', 'favorites'] as const;

let media: ReturnType<typeof installMatchMedia> | undefined;

beforeEach(() => {
  setSourcesPresent(true);
  window.location.hash = '#/settings';
});

afterEach(async () => {
  invalidateSourcesPresence();
  resetAppRouter();
  media?.restore();
  media = undefined;
  window.location.hash = '';
  resetLanguagePreferenceForTests();
  await setLocale('en');
  await wipeAll();
});

describe('navigation labels', () => {
  it('are read from the active locale on every access', async () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual(PRIMARY.map((id) => en.nav[id]));
    await setLocale('pt-PT');
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual(PRIMARY.map((id) => pt.nav[id]));
    expect(SETTINGS_NAV_ITEM.label).toBe(pt.nav.settings);
  });

  it.each([
    ['rail', 1400],
    ['bottom bar', 400],
  ])('switch language without a reload in the %s', async (_name, width) => {
    media = installMatchMedia({ width });
    render(<App />);
    let nav = await screen.findByRole('navigation', { name: en.nav.mainNavigation });
    for (const id of PRIMARY) {
      expect(within(nav).getByRole('link', { name: en.nav[id] })).toBeInTheDocument();
    }

    await act(async () => {
      await setLocale('pt-PT');
    });

    nav = await screen.findByRole('navigation', { name: pt.nav.mainNavigation });
    for (const id of PRIMARY) {
      expect(within(nav).getByRole('link', { name: pt.nav[id] })).toBeInTheDocument();
      if (en.nav[id] !== pt.nav[id]) expect(within(nav).queryByText(en.nav[id])).toBeNull();
    }
    if (width > 600) {
      expect(within(nav).getByRole('link', { name: pt.nav.settings })).toBeInTheDocument();
    }
  });
});
