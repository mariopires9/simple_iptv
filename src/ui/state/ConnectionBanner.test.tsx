// PWA-04 AC1/AC2/AC3: persistent "No connection" banner, gone when the connection returns; it
// never promises offline playback.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeConnectivity } from '@/core/net/test-utils/fakeConnectivity';
import { t } from '@/i18n';
import { en } from '@/i18n/en';
import { ptPT } from '@/i18n/pt-PT';
import { ConnectionBanner } from './ConnectionBanner';

function goOffline(offline: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline);
  act(() => {
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectionBanner', () => {
  it('shows nothing while online', () => {
    render(<ConnectionBanner />);
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
    // The live region is mounted up front so the change is announced.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('appears when the browser goes offline and disappears when it comes back', () => {
    render(<ConnectionBanner />);
    goOffline(true);
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toHaveAttribute('data-status', 'offline');
    expect(screen.getByRole('status')).toHaveTextContent(t.state.connection.offline);

    goOffline(false);
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
  });

  it('dead link (probe failed): explains; "Try again" probes and clears it when reachable', async () => {
    const fake = fakeConnectivity({ reachable: false });
    render(<ConnectionBanner store={fake.store} />);
    await act(async () => {
      fake.store.reportFailure();
      await fake.store.idle();
    });
    expect(screen.getByTestId('connection-banner')).toHaveAttribute('data-status', 'unreachable');
    expect(screen.getByText(t.state.connection.unreachable)).toBeInTheDocument();

    fake.setReachable(true);
    await userEvent.setup().click(screen.getByRole('button', { name: t.state.connection.retry }));
    await act(() => fake.store.idle());
    expect(fake.probeCalls()).toBe(2);
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
    fake.store.dispose();
  });

  it('a provider failure with the origin reachable shows no banner', async () => {
    const fake = fakeConnectivity({ reachable: true });
    render(<ConnectionBanner store={fake.store} />);
    await act(async () => {
      fake.store.reportFailure();
      await fake.store.idle();
    });
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
    fake.store.dispose();
  });

  it('says playback is not possible — never promises offline playback (AC3)', () => {
    expect(en.state.connection.offline).toMatch(/not play/);
    expect(ptPT.state.connection.offline).toMatch(/não reproduzir/);
  });
});
