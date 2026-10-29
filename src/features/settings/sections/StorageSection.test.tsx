// PWA-05 — Settings › Storage: the persisted state and space used (AC1, mocked StorageManager) and
// the iOS-not-installed warning (AC2).
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageStatus } from '@/core/platform';
import { setLocale, t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { renderSettings } from '../test-utils';
import { formatBytes, StorageSection } from './StorageSection';

const text = t.settings.storage;
const MB = 1_000_000;

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(async () => {
  media.restore();
  await setLocale('en');
});

const desktop = { isIOS: () => false, isInstalled: () => false };

describe('StorageSection (PWA-05 AC1)', () => {
  it('shows that the data is persisted and the space used of the quota', async () => {
    const status: StorageStatus = { persisted: true, usage: 12.3 * MB, quota: 2_000 * MB };
    renderSettings(<StorageSection {...desktop} loadStatus={() => Promise.resolve(status)} />);
    expect(await screen.findByText(text.persistedOn)).toBeInTheDocument();
    expect(screen.getByText(text.usageOf('12.3 MB', '2 GB'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.request })).toBeNull();
  });

  it('not persisted: offers to ask again, and shows the new state', async () => {
    const user = userEvent.setup();
    let persisted = false;
    const loadStatus = vi.fn(() => Promise.resolve<StorageStatus>({ persisted, usage: 0 }));
    const requestPersist = vi.fn(() => {
      persisted = true;
      return Promise.resolve(true);
    });
    renderSettings(
      <StorageSection {...desktop} loadStatus={loadStatus} requestPersist={requestPersist} />,
    );
    expect(await screen.findByText(text.persistedOff)).toBeInTheDocument();
    expect(screen.getByText('0 byte')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: text.request }));
    expect(await screen.findByText(text.persistedOn)).toBeInTheDocument();
    expect(requestPersist).toHaveBeenCalledTimes(1);
  });

  it('a refusal is explained', async () => {
    const user = userEvent.setup();
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve({ persisted: false })}
        requestPersist={() => Promise.resolve(false)}
      />,
    );
    await user.click(await screen.findByRole('button', { name: text.request }));
    expect(await screen.findByText(text.requestDenied)).toHaveAttribute('role', 'status');
  });

  it('browsers without the APIs: says it cannot tell', async () => {
    renderSettings(
      <StorageSection {...desktop} loadStatus={() => Promise.resolve({ persisted: undefined })} />,
    );
    expect(await screen.findByText(text.persistedUnknown)).toBeInTheDocument();
    expect(screen.getByText(text.usageUnknown)).toBeInTheDocument();
  });

  it('formats sizes in the active locale', async () => {
    expect(formatBytes(512)).toBe('512 byte');
    expect(formatBytes(1_500)).toBe('1.5 kB');
    expect(formatBytes(2_340_000_000)).toBe('2.3 GB');
    await setLocale('pt-PT');
    expect(formatBytes(12_300_000)).toBe(
      new Intl.NumberFormat('pt-PT', {
        style: 'unit',
        unit: 'megabyte',
        unitDisplay: 'short',
        maximumFractionDigits: 1,
      }).format(12.3),
    );
  });
});

describe('StorageSection (PWA-05 AC2 — iOS not installed)', () => {
  const status = () => Promise.resolve<StorageStatus>({ persisted: false });

  it('warns on iOS when the app is not installed', async () => {
    renderSettings(
      <StorageSection loadStatus={status} isIOS={() => true} isInstalled={() => false} />,
    );
    expect(screen.getByText(text.iosInstall).closest('[role="alert"]')).not.toBeNull();
    expect(text.iosInstall).toBe(
      'Install the app to prevent Safari from deleting your data after 7 days without use',
    );
    await screen.findByText(text.persistedOff);
  });

  it.each([
    ['installed on iOS', true, true],
    ['not iOS', false, false],
  ])('no warning when %s', async (_label, ios, installed) => {
    renderSettings(
      <StorageSection loadStatus={status} isIOS={() => ios} isInstalled={() => installed} />,
    );
    await screen.findByText(text.persistedOff);
    expect(screen.queryByText(text.iosInstall)).toBeNull();
  });
});
