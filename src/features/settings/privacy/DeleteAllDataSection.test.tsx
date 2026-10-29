// SRC-10: Settings › Privacy › "Delete all data" — typed confirmation word, progress, restart on
// success, report + retry on a partial failure.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n';
import { settings as ptSettings } from '@/i18n/pt-PT/settings';
import { PrivacyScreen } from '../PrivacyScreen';
import { renderSettings } from '../test-utils';
import type { DeleteAllDataResult } from './deleteAllData';
import { DeleteAllDataSection, matchesConfirmWord } from './DeleteAllDataSection';

const text = t.settings.privacy.deleteAll;

const OK: DeleteAllDataResult = { failed: [], databaseDeleted: true };

function setup(results: DeleteAllDataResult[] = [OK]) {
  let call = 0;
  let release: () => void = () => undefined;
  const gate = { hold: false };
  const deleteAllData = vi.fn(async () => {
    if (gate.hold) await new Promise<void>((resolve) => (release = resolve));
    return results[Math.min(call++, results.length - 1)]!;
  });
  const restart = vi.fn();
  renderSettings(<DeleteAllDataSection deleteAllData={deleteAllData} restart={restart} />);
  return { deleteAllData, restart, gate, release: () => release(), user: userEvent.setup() };
}

const confirmField = () => screen.getByLabelText(text.dialog.confirmLabel(text.dialog.confirmWord));
const confirmButton = () => screen.getByRole('button', { name: text.dialog.confirm });

describe('Delete all data (SRC-10)', () => {
  it('is on the Privacy and data page', () => {
    renderSettings(<PrivacyScreen />);
    expect(screen.getByRole('region', { name: text.title })).toHaveTextContent(text.description);
    expect(screen.getByRole('button', { name: text.action })).toBeInTheDocument();
  });

  it('AC1: confirming needs the localized word; Cancel deletes nothing', async () => {
    const { user, deleteAllData } = setup();
    await user.click(screen.getByRole('button', { name: text.action }));
    const dialog = await screen.findByRole('dialog', { name: text.dialog.title });
    expect(dialog).toHaveTextContent(text.dialog.message);
    expect(confirmButton()).toBeDisabled();
    await user.type(confirmField(), 'DELET');
    expect(confirmButton()).toBeDisabled();
    await user.type(confirmField(), 'E');
    expect(confirmButton()).toBeEnabled();
    // Enter with a wrong word does nothing either.
    await user.clear(confirmField());
    await user.type(confirmField(), 'nope{Enter}');
    expect(deleteAllData).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: t.state.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteAllData).not.toHaveBeenCalled();
  });

  it('the word is DELETE in English and APAGAR in pt-PT (i18n), case and spaces ignored', () => {
    expect(text.dialog.confirmWord).toBe('DELETE');
    expect(ptSettings.privacy.deleteAll.dialog.confirmWord).toBe('APAGAR');
    expect(matchesConfirmWord(' delete ', 'DELETE')).toBe(true);
    expect(matchesConfirmWord('apagar', 'APAGAR')).toBe(true);
    expect(matchesConfirmWord('DELETE', 'APAGAR')).toBe(false);
  });

  it('AC1: deletes with progress (dialog cannot be dismissed), then restarts on onboarding', async () => {
    const { user, deleteAllData, restart, gate, release } = setup();
    gate.hold = true;
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    await user.click(confirmButton());
    expect(deleteAllData).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('group', { name: text.dialog.deleting })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.state.cancel })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('AC3: a partial failure names what was not deleted and offers to retry', async () => {
    const { user, deleteAllData, restart } = setup([
      { failed: ['database', 'caches'], databaseDeleted: false },
      OK,
    ]);
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    await user.click(confirmButton());

    const failure = await screen.findByTestId('delete-all-failure');
    expect(screen.getByRole('dialog', { name: text.failed.title })).toBeInTheDocument();
    expect(failure).toHaveTextContent(text.failed.message);
    expect(failure).toHaveTextContent(text.failed.parts.database);
    expect(failure).toHaveTextContent(text.failed.parts.caches);
    expect(failure).not.toHaveTextContent(text.failed.parts.storage);
    expect(restart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: text.failed.retry }));
    expect(deleteAllData).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('after a failure, Close keeps the app as it is', async () => {
    const { user, restart } = setup([{ failed: ['database'], databaseDeleted: false }]);
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    await user.click(confirmButton());
    await screen.findByTestId('delete-all-failure');
    await user.click(screen.getByRole('button', { name: text.failed.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(restart).not.toHaveBeenCalled();
  });

  it('database deleted but a later step failed: report it, then Continue restarts', async () => {
    const { user, restart } = setup([{ failed: ['caches'], databaseDeleted: true }]);
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    await user.click(confirmButton());
    const failure = await screen.findByTestId('delete-all-failure');
    expect(failure).toHaveTextContent(text.failed.parts.caches);
    expect(failure).toHaveTextContent(text.failed.deletedNote);
    expect(restart).not.toHaveBeenCalled();
    // Escape cannot leave the app running on a deleted (locked) database either.
    await user.keyboard('{Escape}');
    expect(restart).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: text.failed.continue }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('a deletion blocked by another tab restarts the app when it completes later', async () => {
    let complete: (deleted: boolean) => void = () => undefined;
    const pendingDatabase = new Promise<boolean>((resolve) => (complete = resolve));
    const { user, restart } = setup([
      { failed: ['database'], databaseDeleted: false, pendingDatabase },
    ]);
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    await user.click(confirmButton());
    const failure = await screen.findByTestId('delete-all-failure');
    expect(failure).toHaveTextContent(text.failed.pendingNote);
    expect(screen.getByRole('button', { name: text.failed.continue })).toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
    complete(true);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('a double submit starts one deletion only', async () => {
    const { user, deleteAllData, gate, release } = setup();
    gate.hold = true;
    await user.click(screen.getByRole('button', { name: text.action }));
    await user.type(confirmField(), text.dialog.confirmWord);
    const form = confirmButton().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(deleteAllData).toHaveBeenCalledTimes(1);
    release();
  });
});
