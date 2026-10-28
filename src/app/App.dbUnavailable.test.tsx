import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogBuffer, getLogEntries } from '@/core/log';
import { App } from './App';

const openDatabase = vi.hoisted(() => vi.fn());

vi.mock('@/core/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/db')>()),
  openDatabase,
}));

const { DatabaseUnavailableError } = await import('@/core/db');

beforeEach(() => {
  clearLogBuffer();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  openDatabase.mockReset();
  vi.restoreAllMocks();
});

// FND-04 AC6 / FND-05 AC5: no blank page when IndexedDB cannot be used.
describe('App — database unavailable at start-up', () => {
  it.each([
    ['unsupported', 'This browser does not allow data to be stored on this device.'],
    ['open-failed', 'Could not access the device storage.'],
    ['timeout', 'The device storage did not respond.'],
  ] as const)('reason %s → full-screen message', async (reason, text) => {
    openDatabase.mockRejectedValue(new DatabaseUnavailableError(reason));
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Storage unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${text}`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(getLogEntries().some((e) => e.level === 'error' && e.context?.includes(reason))).toBe(
      true,
    );
    expect(openDatabase).toHaveBeenCalled();
  });

  it('renders the app normally when the database opens', async () => {
    openDatabase.mockResolvedValue({});
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('Storage unavailable')).toBeNull();
  });

  it('a non-availability failure (e.g. closed while opening) does not block the app', async () => {
    openDatabase.mockRejectedValue(new Error('Database closed while opening'));
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('Storage unavailable')).toBeNull();
  });
});
