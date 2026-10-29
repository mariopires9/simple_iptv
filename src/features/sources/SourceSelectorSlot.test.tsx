// TEC-01 review: a failed load of the top-bar selector chunk is not permanent — it is retried on
// the next navigation and when the browser comes back online.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';
import { SourceSelectorSlot, type SelectorLoader } from './SourceSelectorSlot';

const Selector = () => <span>selector loaded</span>;

function renderSlot(loader: SelectorLoader) {
  const Page = () => (
    <>
      <SourceSelectorSlot loader={loader} />
      <Link to="/other">other</Link>
    </>
  );
  const router = createMemoryRouter(
    [
      { path: '/', Component: Page },
      { path: '/other', Component: Page },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

describe('SourceSelectorSlot', () => {
  it('renders the selector once its chunk has loaded', async () => {
    renderSlot(() => Promise.resolve(Selector));
    expect(await screen.findByText('selector loaded')).toBeInTheDocument();
  });

  it('retries a failed load on the next navigation', async () => {
    const loader = vi
      .fn<SelectorLoader>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValue(Selector);
    renderSlot(loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('selector loaded')).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'other' }));
    expect(await screen.findByText('selector loaded')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('retries a failed load when the browser comes back online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const loader = vi
      .fn<SelectorLoader>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Selector);
    renderSlot(loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('selector loaded')).toBeInTheDocument();
    onLine.mockRestore();
  });

  it('does not load again once loaded (later mounts render at once)', async () => {
    const loader = vi.fn<SelectorLoader>().mockResolvedValue(Selector);
    renderSlot(loader);
    await screen.findByText('selector loaded');
    await userEvent.click(screen.getByRole('link', { name: 'other' }));
    expect(screen.getByText('selector loaded')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
