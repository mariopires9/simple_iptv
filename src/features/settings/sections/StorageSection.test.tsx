// PWA-05 — Settings › Storage: the persisted state and space used (AC1, mocked StorageManager) and
// the iOS-not-installed warning (AC2).
import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageStatus } from '@/core/platform';
import { t } from '@/i18n';
import { installMatchMedia } from '@/ui/test-utils/matchMedia';
import { renderSettings } from '../test-utils';
import { StorageSection } from './StorageSection';

const text = t.settings.storage;
const MB = 1_000_000;

let media: ReturnType<typeof installMatchMedia>;
beforeEach(() => {
  media = installMatchMedia({ width: 1200 });
});
afterEach(() => {
  media.restore();
});

const desktop = { isIOS: () => false, isInstalled: () => false };
const status = (fields: Partial<StorageStatus>): StorageStatus => ({
  persisted: undefined,
  canPersist: true,
  ...fields,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StorageSection (PWA-05 AC1)', () => {
  it('shows that the data is persisted and the space used of the quota', async () => {
    const loaded = status({ persisted: true, usage: 12.3 * MB, quota: 2_000 * MB });
    renderSettings(<StorageSection {...desktop} loadStatus={() => Promise.resolve(loaded)} />);
    expect(await screen.findByText(text.persistedOn)).toBeInTheDocument();
    expect(screen.getByText(text.usageOf('12.3 MB', '2 GB'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.request })).toBeNull();
  });

  it('not persisted: offers to ask again, and shows the new state', async () => {
    const user = userEvent.setup();
    let persisted = false;
    const loadStatus = vi.fn(() => Promise.resolve(status({ persisted, usage: 0 })));
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
        loadStatus={() => Promise.resolve(status({ persisted: false }))}
        requestPersist={() => Promise.resolve(false)}
      />,
    );
    await user.click(await screen.findByRole('button', { name: text.request }));
    expect(await screen.findByText(text.requestDenied)).toHaveAttribute('role', 'status');
  });

  it('persisted() missing but persist() present: "Ask again" is offered; the answer is shown', async () => {
    const user = userEvent.setup();
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve(status({ persisted: undefined, canPersist: true }))}
        requestPersist={() => Promise.resolve(true)}
      />,
    );
    expect(await screen.findByText(text.persistedUnknown)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: text.request }));
    expect(await screen.findByText(text.persistedOn)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.request })).toBeNull();
  });

  it('browsers without the APIs: says it cannot tell, offers nothing', async () => {
    renderSettings(
      <StorageSection
        {...desktop}
        loadStatus={() => Promise.resolve(status({ persisted: undefined, canPersist: false }))}
      />,
    );
    expect(await screen.findByText(text.persistedUnknown)).toBeInTheDocument();
    expect(screen.getByText(text.usageUnknown)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.request })).toBeNull();
  });

  it('the button is busy while asking and usable again after a failure', async () => {
    const user = userEvent.setup();
    const answer = deferred<boolean | undefined>();
    const loadStatus = vi
      .fn<() => Promise<StorageStatus>>()
      .mockResolvedValueOnce(status({ persisted: false }))
      .mockRejectedValueOnce(new Error('estimate failed'));
    renderSettings(
      <StorageSection {...desktop} loadStatus={loadStatus} requestPersist={() => answer.promise} />,
    );
    const button = await screen.findByRole('button', { name: text.request });
    await user.click(button);
    expect(button).toBeDisabled();
    answer.resolve(true);
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('no state update after unmount while asking', async () => {
    const user = userEvent.setup();
    const answer = deferred<boolean | undefined>();
    const loadStatus = vi.fn(() => Promise.resolve(status({ persisted: false })));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderSettings(
      <StorageSection {...desktop} loadStatus={loadStatus} requestPersist={() => answer.promise} />,
    );
    await user.click(await screen.findByRole('button', { name: text.request }));
    view.unmount();
    answer.resolve(true);
    await waitFor(() => expect(loadStatus).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('StorageSection (PWA-05 AC2 — iOS not installed)', () => {
  const load = () => Promise.resolve(status({ persisted: false }));

  it('warns on iOS when the app is not installed', async () => {
    renderSettings(
      <StorageSection loadStatus={load} isIOS={() => true} isInstalled={() => false} />,
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
      <StorageSection loadStatus={load} isIOS={() => ios} isInstalled={() => installed} />,
    );
    await screen.findByText(text.persistedOff);
    expect(screen.queryByText(text.iosInstall)).toBeNull();
  });
});
