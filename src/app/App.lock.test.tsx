// SEC-02: with a master password the app opens on the unlock screen (nothing that reads secrets is
// mounted), rejects a wrong password, and opens normally after the right one.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMasterPassword, resetVaultLock } from '@/core/crypto';
import { settingsRepo, wipeAll } from '@/core/db';
import { invalidateSourcesPresence, setSourcesPresent } from '@/features/sources';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { App } from './App';
import { resetAppRouter } from './router';

const PASSWORD = 'synthetic master pw';
let media: ReturnType<typeof installMatchMedia> | undefined;

beforeEach(async () => {
  setSourcesPresent(true);
  resetVaultLock();
  const { config } = await createMasterPassword(PASSWORD);
  await settingsRepo.set('masterPassword', config);
  window.location.hash = '';
  media = installMatchMedia({ width: 1400 });
});

afterEach(async () => {
  invalidateSourcesPresence();
  resetAppRouter();
  media?.restore();
  resetVaultLock();
  await wipeAll();
});

describe('App — master password (SEC-02)', () => {
  it('opens on an accessible unlock screen; a wrong password is refused, the right one unlocks', async () => {
    const user = userEvent.setup();
    render(<App />);

    const dialog = await screen.findByRole('dialog', { name: 'Simple IPTV is locked' });
    expect(dialog).toHaveAccessibleDescription('Enter your master password to use your lists.');
    // Lock on open: the router (and every screen that could read a secret) is not mounted.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    // No recovery: "forgot" leads to deleting all data.
    expect(screen.getByRole('button', { name: 'Delete all data…' })).toBeInTheDocument();

    const field = screen.getByLabelText('Master password');
    await user.type(field, 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is not the master password. Try again.',
    );
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Master password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Home' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Simple IPTV is locked' })).not.toBeInTheDocument();
  }, 15_000);
});
