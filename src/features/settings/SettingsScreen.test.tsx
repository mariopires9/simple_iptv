import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n';
import { SettingsScreen } from './SettingsScreen';

describe('SettingsScreen (SRC-08 AC0)', () => {
  it('links to My lists and to Privacy', () => {
    const router = createMemoryRouter([{ path: '/settings', Component: SettingsScreen }], {
      initialEntries: ['/settings'],
    });
    render(<RouterProvider router={router} />);
    const text = t.routes.screens.settings;
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(text.myLists) })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    expect(screen.getByRole('link', { name: new RegExp(text.privacy) })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
  });
});
