// EXP-01 — Settings › Backup: export downloads `simple-iptv-YYYY-MM-DD.json` through a Blob
// object URL that is revoked, the export password is validated; import previews the file (counts,
// secrets, password prompt), reports a wrong password and an invalid file, and restarts the app on
// success. Synthetic data only.
import 'fake-indexeddb/auto';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialVault } from '@/core/crypto';
import { favoritesRepo, itemKey, sourcesRepo, wipeAll, type Source } from '@/core/db';
import { clearSecrets } from '@/core/log';
import { takeSourcesPendingSync } from '@/core/session';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { buildBackup, serializeBackup } from '../backup/exportBackup';
import { backupRestart } from '../backup/importBackup';
import { renderSettings } from '../test-utils';
import { BackupSection } from './BackupSection';

const text = t.settings.backup;
const PASSWORD = 'synthetic-xtream-pass-42';
const EXPORT_PASSWORD = 'correct horse battery';
const X = '00000000-0000-4000-8000-000000000004';

const list: Source = {
  id: X,
  kind: 'xtream',
  name: 'List X',
  serverUrl: 'http://panel.example.test:8080',
  username: 'demo',
  secretRef: `source:${X}:password`,
  prefs: { liveFormat: 'auto' },
  createdAt: 1,
  lastSyncStatus: 'ok',
  stats: { live: 0, movies: 0, series: 0 },
};

async function seed() {
  await credentialVault.put(`source:${X}:password`, PASSWORD);
  await sourcesRepo.put(list);
  await favoritesRepo.add(itemKey(X, 'live', '1'), 1);
}

let media: ReturnType<typeof installMatchMedia>;
let blobs: Blob[];
let revoked: string[];
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
  blobs = [];
  revoked = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:backup-${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  media.restore();
  clearSecrets();
  takeSourcesPendingSync();
  await wipeAll();
});

describe('BackupSection — export (EXP-01)', () => {
  it('downloads a dated JSON file through a revoked object URL, with no secret without a password', async () => {
    await seed();
    const user = userEvent.setup();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    renderSettings(<BackupSection />);
    expect(screen.getByRole('heading', { name: t.settings.sections.backup })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: text.export }));
    await waitFor(() =>
      expect(screen.getByTestId('toast-polite')).toHaveTextContent(text.exported),
    );
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^simple-iptv-\d{4}-\d{2}-\d{2}\.json$/);
    await waitFor(() => expect(revoked).toEqual(['blob:backup-1']));
    const content = await blobs[0]!.text();
    expect(JSON.parse(content)).toMatchObject({ format: 'simple-iptv-export', version: 1 });
    expect(content).not.toContain(PASSWORD);
  });

  it('with secrets: the password must be long enough and repeated', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderSettings(<BackupSection />);
    await user.click(screen.getByRole('checkbox', { name: text.includeSecrets }));
    await user.type(screen.getByLabelText(text.password), 'short');
    await user.click(screen.getByRole('button', { name: text.export }));
    expect(screen.getByLabelText(text.password)).toHaveAccessibleDescription(
      text.errors.tooShort(8),
    );
    await user.type(screen.getByLabelText(text.password), '-but-now-long');
    await user.type(screen.getByLabelText(text.confirmPassword), 'different');
    await user.click(screen.getByRole('button', { name: text.export }));
    expect(screen.getByLabelText(text.confirmPassword)).toHaveAccessibleDescription(
      text.errors.mismatch,
    );
    expect(blobs).toHaveLength(0);
  });
});

describe('BackupSection — import (EXP-01)', () => {
  async function backupFile(password?: string) {
    const { file } = await buildBackup(password ? { password } : {});
    return new File([serializeBackup(file)], 'simple-iptv-2026-10-30.json', {
      type: 'application/json',
    });
  }

  it('previews an encrypted file, rejects a wrong password, then imports and restarts', async () => {
    await seed();
    const file = await backupFile(EXPORT_PASSWORD);
    clearSecrets();
    await wipeAll();
    const restart = vi.spyOn(backupRestart, 'restartOnLists').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderSettings(<BackupSection />);

    await user.upload(screen.getByTestId('backup-file-input'), file);
    const dialog = await screen.findByRole('dialog', { name: text.preview.title });
    const counts = within(dialog).getByTestId('backup-preview-counts');
    expect(counts).toHaveTextContent('1 list');
    expect(counts).toHaveTextContent('1 favorite');
    expect(within(dialog).getByTestId('backup-preview-secrets')).toHaveTextContent(
      text.preview.secretsIncluded(1, '1'),
    );

    await user.type(within(dialog).getByLabelText(text.preview.password), 'wrong password');
    await user.click(within(dialog).getByRole('button', { name: text.preview.confirm }));
    expect(
      await within(dialog).findByText(text.preview.wrongPassword, {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(await sourcesRepo.list()).toEqual([]);
    expect(restart).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(text.preview.password));
    await user.type(within(dialog).getByLabelText(text.preview.password), EXPORT_PASSWORD);
    await user.click(within(dialog).getByRole('radio', { name: text.preview.replace }));
    await user.click(within(dialog).getByRole('button', { name: text.preview.confirm }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    const [imported] = await sourcesRepo.list();
    expect(await credentialVault.get(imported!.secretRef!)).toBe(PASSWORD);
  });

  it('a plain file says it has no secrets and asks for no password', async () => {
    await seed();
    const file = await backupFile();
    const user = userEvent.setup();
    renderSettings(<BackupSection />);
    await user.upload(screen.getByTestId('backup-file-input'), file);
    const dialog = await screen.findByRole('dialog', { name: text.preview.title });
    expect(within(dialog).getByTestId('backup-preview-secrets')).toHaveTextContent(
      text.preview.noSecrets,
    );
    expect(within(dialog).queryByLabelText(text.preview.password)).toBeNull();
  });

  it('an invalid file is reported and opens no preview', async () => {
    const user = userEvent.setup();
    renderSettings(<BackupSection />);
    await user.upload(
      screen.getByTestId('backup-file-input'),
      new File(['{"format":"something-else","version":1,"sources":[]}'], 'x.json', {
        type: 'application/json',
      }),
    );
    expect(await screen.findByText(text.readErrors['not-backup'])).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an import that stops part-way says so and only offers to restart', async () => {
    await seed();
    const file = await backupFile();
    vi.spyOn(favoritesRepo, 'putMany').mockRejectedValue(new Error('disk'));
    const restart = vi.spyOn(backupRestart, 'restartOnLists').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderSettings(<BackupSection />);
    await user.upload(screen.getByTestId('backup-file-input'), file);
    const dialog = await screen.findByRole('dialog', { name: text.preview.title });
    await user.click(within(dialog).getByRole('radio', { name: text.preview.replace }));
    await user.click(within(dialog).getByRole('button', { name: text.preview.confirm }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text.importPartial);
    expect(within(dialog).getByRole('button', { name: t.state.cancel })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: text.restart }));
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
