// UX-02 AC5: the FND-04 status screens render through the shared StateView and its strings.
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { DatabaseUnavailableScreen } from '../DatabaseUnavailableScreen';
import { NotFoundScreen } from './NotFoundScreen';

describe('FND-04 screens on StateView', () => {
  it('NotFoundScreen: non-error state (role="status") with a level-1 heading', () => {
    const router = createMemoryRouter([{ path: '*', Component: NotFoundScreen }]);
    render(<RouterProvider router={router} />);
    const section = screen.getByRole('region', { name: 'Page not found' });
    expect(section).toHaveAttribute('data-variant', 'empty');
    expect(screen.getByRole('status')).toHaveTextContent('Page not found');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('DatabaseUnavailableScreen: error state (role="alert") inside <main>, state.* strings', () => {
    render(<DatabaseUnavailableScreen reason="timeout" />);
    const section = screen.getByRole('region', { name: t.state.errors.db.title });
    expect(section).toHaveAttribute('data-variant', 'error');
    expect(screen.getByRole('main')).toContainElement(section);
    expect(screen.getByRole('alert')).toHaveTextContent(t.db.errors.timeout);
    expect(screen.getByRole('button', { name: t.state.actions.reload })).toBeInTheDocument();
  });
});
