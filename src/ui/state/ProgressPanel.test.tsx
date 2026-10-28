import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProgressPanel } from './ProgressPanel';

const format = (n: number) => new Intl.NumberFormat('en').format(n);

describe('ProgressPanel', () => {
  it('determinate: count/total sets the bar value and the count text', () => {
    render(<ProgressPanel phase="Loading movies…" count={12400} total={50000} />);
    const bar = screen.getByRole('progressbar', { name: 'Loading movies…' });
    expect(bar).toHaveAttribute('aria-valuenow', '24.8');
    const text = `${format(12400)} of ${format(50000)}`;
    expect(bar).toHaveAttribute('aria-valuetext', text);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Loading movies…' })).toBeInTheDocument();
  });

  it('clamps the value to 0–100', () => {
    render(<ProgressPanel phase="Sync" count={150} total={100} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('indeterminate without a total, still showing the count', () => {
    render(<ProgressPanel phase="Reading list…" count={980} />);
    const bar = screen.getByRole('progressbar', { name: 'Reading list…' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText(`${format(980)} processed`)).toBeInTheDocument();
  });

  it('indeterminate with neither count nor total (and total 0)', () => {
    const { rerender } = render(<ProgressPanel phase="Connecting…" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    rerender(<ProgressPanel phase="Connecting…" count={0} total={0} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('announces the phase through a polite live region (not the count)', () => {
    const { rerender } = render(<ProgressPanel phase="Loading channels…" count={1} total={9} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading channels…');
    rerender(<ProgressPanel phase="Loading movies…" count={2} total={9} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading movies…$/);
  });

  it('cancel button: keyboard-reachable, calls onCancel; disabled while cancelling', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(<ProgressPanel phase="Sync" onCancel={onCancel} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<ProgressPanel phase="Sync" onCancel={onCancel} cancelling />);
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
  });

  it('no cancel button without onCancel', () => {
    render(<ProgressPanel phase="Sync" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
