import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from '@mui/material/Button';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSecrets, registerSecret } from '@/core/log';
import { StateView, type StateViewVariant } from './StateView';

afterEach(() => clearSecrets());

describe('StateView', () => {
  it.each([
    ['empty', 'status'],
    ['no-results', 'status'],
    ['offline', 'status'],
    ['error', 'alert'],
  ] as const satisfies readonly (readonly [StateViewVariant, string])[])(
    '%s → section landmark labelled by its heading; role="%s" on title + message only',
    (variant, role) => {
      render(<StateView variant={variant} title="The title" message="The message" />);
      const section = screen.getByRole('region', { name: 'The title' });
      expect(section.tagName).toBe('SECTION');
      expect(section).toHaveAttribute('data-variant', variant);
      expect(section).not.toHaveAttribute('role');
      const live = screen.getByRole(role);
      expect(section).toContainElement(live);
      expect(live).toHaveTextContent(/^The titleThe message$/);
      expect(screen.getByRole('heading', { level: 2, name: 'The title' })).toBeInTheDocument();
      // The icon is decorative.
      expect(section.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    },
  );

  // Review finding 8: actions and details are not announced as part of the alert.
  it('keeps actions and details outside the live region', () => {
    render(
      <StateView
        variant="error"
        title="Failed"
        message="It broke"
        actions={<Button>Try again</Button>}
        details="NetError: timeout"
      />,
    );
    const live = screen.getByRole('alert');
    expect(live).not.toContainElement(screen.getByRole('button', { name: 'Try again' }));
    expect(live).not.toContainElement(screen.getByText('Details'));
    expect(live).toHaveTextContent(/^FailedIt broke$/);
  });

  it('error and non-error variants never share a role', () => {
    render(<StateView variant="error" title="Err" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('supports another heading level for full-screen states', () => {
    render(<StateView variant="empty" title="Page not found" headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('renders the actions, reachable with the keyboard', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <StateView
        variant="error"
        title="Failed"
        actions={
          <>
            <Button onClick={retry}>Try again</Button>
            <Button>Go to Home</Button>
          </>
        }
        details="NetError: timeout"
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Go to Home' })).toHaveFocus();
    await user.tab();
    expect(screen.getByText('Details')).toHaveFocus();
  });

  // Native <details>/<summary>: focusable and toggled with Enter/Space by the browser (jsdom only
  // implements the click activation, which is what the keyboard triggers).
  it('shows details in a closed "Details" disclosure', async () => {
    const user = userEvent.setup();
    render(<StateView variant="error" title="Failed" details="NetError: Request timed out" />);
    const summary = screen.getByText('Details');
    const disclosure = summary.closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    await user.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('NetError: Request timed out')).toBeVisible();
  });

  it('redacts the details (registered secret → ***)', () => {
    registerSecret('s3cr3t-pass');
    render(
      <StateView
        variant="error"
        title="Failed"
        details="Error: auth failed for s3cr3t-pass at http://h/get.php?password=other"
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('s3cr3t-pass');
    expect(text).not.toContain('password=other');
    expect(screen.getByText(/auth failed for \*\*\*/)).toBeInTheDocument();
  });

  it('has no "Details" disclosure without details, nor actions without actions', () => {
    render(<StateView variant="empty" title="Empty" details="" />);
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
