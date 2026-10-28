import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom reports navigator.languages = ['en-US'], so `t` resolves to the base locale (en).
// No IndexedDB / matchMedia here: the app must still render (theme falls back to System → dark).
describe('App', () => {
  it('renders the shell with the application name and the English placeholder', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Simple IPTV' })).toBeInTheDocument();
    expect(screen.getByText('Under construction.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
});
