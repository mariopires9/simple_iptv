// SEC-03 — Settings › Parental control: set a 4–8 digit PIN (stored as a hash), mark Live/Movies/
// Series categories as restricted, change/remove only with the current PIN, "forgot PIN" points to
// "Delete all data", and the deterrent warning is explicit.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogRepo, categoryKey, settingsRepo, sourcesRepo, wipeAll } from '@/core/db';
import { forgetActiveSource } from '@/core/session';
import {
  getParentalSnapshot,
  lockParental,
  resetParentalForTests,
  setParentalPin,
} from '@/core/session/parental';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { m3uSource } from '@/ui/test-utils/sources';
import { renderSettings } from '../test-utils';
import { ParentalSection } from './ParentalSection';

const text = t.parental.settings;
const SOURCE = 'pc1';

let media: ReturnType<typeof installMatchMedia>;
beforeEach(async () => {
  media = installMatchMedia({ width: 1200 });
  resetParentalForTests({ iterations: 1_000 });
  await sourcesRepo.put(m3uSource(SOURCE, 'Family list', 1));
  await catalogRepo.replaceForSource(SOURCE, 'movie', {
    categories: [
      { externalId: 'kids', name: 'Kids' },
      { externalId: 'adult', name: 'Late night' },
    ],
    items: [],
  });
  await settingsRepo.set('activeSourceId', SOURCE);
});
afterEach(async () => {
  cleanup();
  media.restore();
  forgetActiveSource();
  resetParentalForTests();
  await wipeAll();
});

async function typePin(label: string, value: string) {
  const field = screen.getByLabelText(label);
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

describe('ParentalSection (SEC-03)', () => {
  it('says it is a deterrent and sets a PIN (validated, confirmed, stored hashed)', async () => {
    renderSettings(<ParentalSection />);
    expect(screen.getByRole('region', { name: text.title })).toBeInTheDocument();
    expect(screen.getByText(text.deterrent)).toBeInTheDocument();
    expect(await screen.findByText(text.statusOff)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: text.setPin }));
    const dialog = screen.getByRole('dialog', { name: text.setPin });
    await typePin(text.newPin, '12');
    await typePin(text.confirmPin, '12');
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    expect(within(dialog).getByText(text.invalidPin)).toBeInTheDocument();

    await typePin(text.newPin, '2468');
    await typePin(text.confirmPin, '2469');
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    expect(within(dialog).getByText(text.mismatch)).toBeInTheDocument();

    await typePin(text.confirmPin, '2468');
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    expect(await screen.findByText(text.statusUnlocked)).toBeInTheDocument();
    const stored = await settingsRepo.get('parentalControl');
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('2468');
    // "Forgot PIN" = delete all data.
    expect(screen.getByText(text.forgot, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: text.forgotLink })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
  });

  it('marks categories of the active list as restricted', async () => {
    await setParentalPin('1234');
    renderSettings(<ParentalSection />);
    await userEvent.click(
      await screen.findByRole('button', { name: text.choose(text.types.movie, 0) }),
    );
    const dialog = screen.getByRole('dialog', { name: text.pickerTitle(text.types.movie) });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Late night' }));
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    expect(
      await screen.findByRole('button', { name: text.choose(text.types.movie, 1) }),
    ).toBeInTheDocument();
    expect([...getParentalSnapshot().restricted]).toEqual([categoryKey(SOURCE, 'movie', 'adult')]);
    // The pickers exist for Live and Series too.
    expect(screen.getByRole('button', { name: text.choose(text.types.live, 0) })).toBeVisible();
    expect(screen.getByRole('button', { name: text.choose(text.types.series, 0) })).toBeVisible();

    // Locked: the categories need the PIN first.
    await userEvent.click(screen.getByRole('button', { name: text.lockNow }));
    expect(await screen.findByText(text.statusLocked)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.choose(text.types.movie, 1) })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: text.unlock }));
    await typePin(t.parental.prompt.pin, '1234');
    await userEvent.click(screen.getByRole('button', { name: t.parental.prompt.unlock }));
    expect(await screen.findByText(text.statusUnlocked)).toBeInTheDocument();
  });

  it('change and remove need the current PIN', async () => {
    await setParentalPin('1234');
    lockParental();
    renderSettings(<ParentalSection />);

    await userEvent.click(await screen.findByRole('button', { name: text.changePin }));
    let dialog = screen.getByRole('dialog', { name: text.changePin });
    await typePin(text.currentPin, '0000');
    await typePin(text.newPin, '5555');
    await typePin(text.confirmPin, '5555');
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    expect(await within(dialog).findByText(text.wrongPin)).toBeInTheDocument();
    await typePin(text.currentPin, '1234');
    await userEvent.click(within(dialog).getByRole('button', { name: text.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: text.removePin }));
    dialog = screen.getByRole('dialog', { name: text.removeTitle });
    await typePin(text.currentPin, '1234');
    await userEvent.click(within(dialog).getByRole('button', { name: text.removePin }));
    expect(await within(dialog).findByText(text.wrongPin)).toBeInTheDocument();
    await typePin(text.currentPin, '5555');
    await userEvent.click(within(dialog).getByRole('button', { name: text.removePin }));
    expect(await screen.findByText(text.statusOff)).toBeInTheDocument();
    expect(await settingsRepo.get('parentalControl')).toBeUndefined();
  });
});
