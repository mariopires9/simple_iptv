// SEC-02: Settings › Privacy › Master password — the no-recovery warning must be acknowledged
// before enabling; the disable dialog reports a wrong password.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetVaultLock, setMasterKey, setVaultLockOff } from '@/core/crypto/lockState';
import { WrongMasterPasswordError } from '@/core/crypto';
import { renderSettings } from '../test-utils';
import { MasterPasswordSection } from './MasterPasswordSection';

afterEach(() => resetVaultLock());

describe('MasterPasswordSection (SEC-02)', () => {
  it('enabling shows the no-recovery warning and needs it acknowledged and a matching password', async () => {
    setVaultLockOff();
    const enable = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderSettings(<MasterPasswordSection enable={enable} />);

    await user.click(screen.getByRole('button', { name: 'Set a master password…' }));
    const dialog = screen.getByRole('dialog', { name: 'Set a master password' });
    expect(dialog).toHaveAccessibleDescription(
      /There is no way to recover a forgotten master password/,
    );
    const submit = within(dialog).getByRole('button', { name: 'Set master password' });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Master password'), 'synthetic-pw-1');
    await user.type(within(dialog).getByLabelText('Repeat the master password'), 'different');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(submit);
    expect(within(dialog).getByText('The passwords do not match')).toBeInTheDocument();
    expect(enable).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Repeat the master password'));
    await user.type(within(dialog).getByLabelText('Repeat the master password'), 'synthetic-pw-1');
    await user.click(submit);
    expect(enable).toHaveBeenCalledWith('synthetic-pw-1');
  });

  it('when on: lock delay, lock now, and a wrong password when turning it off', async () => {
    setMasterKey({ kid: 'master:test', key: {} as CryptoKey });
    const disable = vi.fn(() => Promise.reject(new WrongMasterPasswordError()));
    const user = userEvent.setup();
    renderSettings(<MasterPasswordSection disable={disable} />);

    expect(
      screen.getByRole('combobox', { name: 'Lock after, in the background' }),
    ).toHaveTextContent('5 minutes');
    await user.click(screen.getByRole('button', { name: 'Turn off the master password…' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn off the master password?' });
    await user.type(within(dialog).getByLabelText('Master password'), 'wrong-pw');
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That is not the master password.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Lock now' }));
    });
    const { getVaultLockStatus } = await import('@/core/crypto/lockState');
    expect(getVaultLockStatus()).toBe('locked');
  });
});
