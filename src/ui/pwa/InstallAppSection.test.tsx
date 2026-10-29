import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InstallOutcome, InstallPromptStore, InstallState } from '@/core/platform';
import { t } from '@/i18n';
import { messages } from '@/i18n/catalogs';
import { InstallAppSection } from './InstallAppSection';

function fakeStore(initial: InstallState, outcome: InstallOutcome = 'accepted') {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (next: InstallState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const prompt = vi.fn(async () => {
    set(outcome === 'accepted' ? 'installed' : 'unsupported');
    return outcome;
  });
  const store: InstallPromptStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt,
    stop: () => {},
  };
  return { store, prompt, set };
}

const text = t.install;

describe('InstallAppSection (PWA-01 AC3)', () => {
  it('Chrome/Edge when eligible: an "Install app" button that opens the browser prompt', async () => {
    const { store, prompt } = fakeStore('available');
    render(<InstallAppSection store={store} />);
    expect(screen.getByRole('heading', { level: 2, name: text.title })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: text.button }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(text.installed)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.button })).not.toBeInTheDocument();
  });

  it('dismissed prompt: a neutral note, no button and no promise of an install', async () => {
    const { store } = fakeStore('available', 'dismissed');
    render(<InstallAppSection store={store} />);
    await userEvent.click(screen.getByRole('button', { name: text.button }));
    expect(await screen.findByRole('status')).toHaveTextContent(text.dismissed);
    expect(screen.queryByRole('button', { name: text.button })).not.toBeInTheDocument();
    expect(screen.queryByText(text.description)).not.toBeInTheDocument();
  });

  it('a failing prompt never surfaces as an error (no unhandled rejection)', async () => {
    const { store, prompt } = fakeStore('available');
    prompt.mockRejectedValueOnce(new Error('boom'));
    render(<InstallAppSection store={store} />);
    await userEvent.click(screen.getByRole('button', { name: text.button }));
    expect(screen.getByRole('button', { name: text.button })).toBeEnabled();
  });

  it('iOS: the "Share → Add to Home Screen" instructions, no button', () => {
    const { store } = fakeStore('ios');
    render(<InstallAppSection store={store} />);
    expect(screen.getByText(text.ios.intro)).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((li) => li.textContent?.trim())).toEqual([
      text.ios.share,
      text.ios.addToHomeScreen,
    ]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('installed: a status line only', () => {
    const { store } = fakeStore('installed');
    render(<InstallAppSection store={store} />);
    expect(screen.getByText(text.installed)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('no install prompt (e.g. Firefox): renders nothing', () => {
    const { store } = fakeStore('unsupported');
    const { container } = render(<InstallAppSection store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears when the browser fires beforeinstallprompt after mount', () => {
    const { store, set } = fakeStore('unsupported');
    render(<InstallAppSection store={store} headingLevel={3} />);
    act(() => set('available'));
    expect(screen.getByRole('heading', { level: 3, name: text.title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.button })).toBeEnabled();
  });

  it('has the iOS wording in both locales', () => {
    expect(messages('en').install.ios.addToHomeScreen).toContain('Add to Home Screen');
    expect(messages('pt-PT').install.ios.addToHomeScreen).toContain('Adicionar ao ecrã principal');
    expect(messages('pt-PT').install.button).toBe('Instalar app');
  });
});
