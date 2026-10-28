import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

// jsdom reports navigator.languages = ['en-US'], so `t` resolves to the base locale (en).
describe('App', () => {
  it('shows the application name and the English placeholder', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Simple IPTV' })).toBeInTheDocument();
    expect(screen.getByText('Under construction.')).toBeInTheDocument();
  });
});
