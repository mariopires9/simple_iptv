// UX-02 AC5: the FND-04 status screens render through the shared StateView.
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DatabaseUnavailableScreen } from '../DatabaseUnavailableScreen';
import { NotFoundScreen } from './NotFoundScreen';

describe('FND-04 screens on StateView', () => {
  it('NotFoundScreen: non-error state (role="status") with a level-1 heading', () => {
    const router = createMemoryRouter([{ path: '*', Component: NotFoundScreen }]);
    render(<RouterProvider router={router} />);
    const region = screen.getByRole('status', { name: 'Page not found' });
    expect(region).toHaveAttribute('data-variant', 'empty');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('DatabaseUnavailableScreen: error state (role="alert") inside <main>', () => {
    render(<DatabaseUnavailableScreen reason="timeout" />);
    const region = screen.getByRole('alert', { name: 'Storage unavailable' });
    expect(region).toHaveAttribute('data-variant', 'error');
    expect(screen.getByRole('main')).toContainElement(region);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
