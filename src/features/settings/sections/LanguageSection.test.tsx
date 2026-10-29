// UX-06: the focus hand-off across the language re-mount is dropped when the switch fails, so a
// later, unrelated re-mount in that locale does not steal the focus.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as i18n from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { renderSettings } from '../test-utils';
import { LanguageSection } from './LanguageSection';

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>();
  return { ...actual, setLanguagePreference: vi.fn(actual.setLanguagePreference) };
});

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(async () => {
  media.restore();
  i18n.resetLanguagePreferenceForTests();
  await i18n.setLocale('en');
});

const names = () => i18n.t.settings.language.names;

describe('LanguageSection — focus after the switch', () => {
  it('a failed switch leaves no pending refocus for a later re-mount', async () => {
    vi.mocked(i18n.setLanguagePreference).mockResolvedValueOnce('failed');
    const user = userEvent.setup();
    const first = renderSettings(<LanguageSection />);
    await user.click(screen.getByRole('radio', { name: names()['pt-PT'] }));
    await vi.waitFor(() => expect(i18n.setLanguagePreference).toHaveBeenCalledWith('pt-PT'));
    await Promise.resolve();
    first.unmount();

    // Later the locale becomes pt-PT for another reason; the section mounts again.
    await i18n.setLocale('pt-PT');
    renderSettings(<LanguageSection />);
    expect(document.body).toHaveFocus();
  });

  it('a successful switch puts the focus back on the chosen option after the re-mount', async () => {
    const user = userEvent.setup();
    const first = renderSettings(<LanguageSection />);
    await user.click(screen.getByRole('radio', { name: names()['pt-PT'] }));
    await vi.waitFor(() => expect(i18n.activeLocale()).toBe('pt-PT'));
    first.unmount(); // what the app's keyed re-mount does
    renderSettings(<LanguageSection />);
    expect(screen.getByRole('radio', { name: names()['pt-PT'] })).toHaveFocus();
  });
});
