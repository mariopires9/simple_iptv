import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../theme/createAppTheme';
import {
  TOAST_DURATION_MS,
  TOAST_WITH_ACTION_DURATION_MS,
  ToastProvider,
  useToast,
  type ToastApi,
} from './ToastProvider';

let api: ToastApi;
/** Every API value the consumer effect saw (the effect re-runs only when the identity changes). */
let seen: ToastApi[] = [];
const setApi = (value: ToastApi) => {
  api = value;
  seen.push(value);
};

function Capture() {
  const toast = useToast();
  useEffect(() => setApi(toast), [toast]);
  return null;
}

// Reduced motion: zero-length transitions, so the queue advances without animation delays.
function renderToasts(children?: ReactNode, reducedMotion = true) {
  seen = [];
  return render(
    <ThemeProvider theme={createAppTheme('dark', { reducedMotion })}>
      <ToastProvider>
        <Capture />
        {children}
      </ToastProvider>
    </ThemeProvider>,
  );
}

const polite = () => screen.getByTestId('toast-polite');
const assertive = () => screen.getByTestId('toast-assertive');
const visibleToast = () => document.querySelector('.MuiSnackbar-root');

afterEach(() => vi.useRealTimers());

describe('ToastProvider', () => {
  it('keeps both live regions mounted (polite status + assertive alert), empty at rest', () => {
    renderToasts();
    expect(polite()).toHaveAttribute('role', 'status');
    expect(assertive()).toHaveAttribute('role', 'alert');
    expect(polite()).toBeEmptyDOMElement();
    expect(assertive()).toBeEmptyDOMElement();
    expect(visibleToast()).toBeNull();
  });

  it('info/success toasts are announced politely', () => {
    renderToasts();
    act(() => void api.show({ message: 'Saved' }));
    expect(polite()).toHaveTextContent('Saved');
    expect(assertive()).toBeEmptyDOMElement();
    expect(visibleToast()).toHaveTextContent('Saved');
  });

  it('error toasts are announced assertively', () => {
    renderToasts();
    act(() => void api.show({ message: 'Could not save', severity: 'error' }));
    expect(assertive()).toHaveTextContent('Could not save');
    expect(polite()).toBeEmptyDOMElement();
  });

  it('the visible toast is not a second live region', () => {
    renderToasts();
    act(() => void api.show({ message: 'Saved' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows at most one toast; the rest are queued in order', async () => {
    const user = userEvent.setup();
    renderToasts();
    act(() => {
      api.show({ message: 'First' });
      api.show({ message: 'Second', severity: 'error' });
      api.show({ message: 'Third' });
    });
    expect(document.querySelectorAll('.MuiSnackbar-root')).toHaveLength(1);
    expect(visibleToast()).toHaveTextContent('First');
    expect(screen.queryByText('Second')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(visibleToast()).toHaveTextContent('Second'));
    expect(assertive()).toHaveTextContent('Second');
    expect(polite()).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(visibleToast()).toHaveTextContent('Third'));
    expect(polite()).toHaveTextContent('Third');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(visibleToast()).toBeNull());
    expect(polite()).toBeEmptyDOMElement();
  });

  it('auto-hides after the default duration, then shows the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderToasts();
    act(() => {
      api.show({ message: 'One' });
      api.show({ message: 'Two' });
    });
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(polite()).toHaveTextContent('One');
    act(() => void vi.advanceTimersByTime(1));
    expect(polite()).toBeEmptyDOMElement();
    await act(async () => void (await vi.advanceTimersByTimeAsync(50)));
    expect(polite()).toHaveTextContent('Two');
  });

  it('a toast with an action stays longer; durationMs null keeps it until dismissed', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderToasts();
    act(() => void api.show({ message: 'Removed', action: { label: 'Undo', onClick: vi.fn() } }));
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS + 100));
    expect(polite()).toHaveTextContent('Removed');
    act(() => void vi.advanceTimersByTime(TOAST_WITH_ACTION_DURATION_MS));
    expect(polite()).toBeEmptyDOMElement();
  });

  it('durationMs null: never auto-hides', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderToasts();
    act(() => void api.show({ message: 'Sticky', durationMs: null }));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(polite()).toHaveTextContent('Sticky');
  });

  it('the action button runs the callback and dismisses; it is keyboard-reachable', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    renderToasts(<button type="button">Before</button>);
    act(() => void api.show({ message: 'Removed', action: { label: 'Undo', onClick: undo } }));
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(visibleToast()).toBeNull());
  });

  it('Escape dismisses the visible toast; a click elsewhere does not', async () => {
    const user = userEvent.setup();
    renderToasts(<button type="button">Elsewhere</button>);
    act(() => void api.show({ message: 'Hello' }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(polite()).toHaveTextContent('Hello');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(visibleToast()).toBeNull());
  });

  it('dismiss(id) removes a queued toast; dismiss() closes the visible one', async () => {
    renderToasts();
    let queued = 0;
    act(() => {
      api.show({ message: 'Visible' });
      queued = api.show({ message: 'Queued' });
      api.show({ message: 'Last' });
    });
    act(() => api.dismiss(queued));
    act(() => api.dismiss());
    await waitFor(() => expect(visibleToast()).toHaveTextContent('Last'));
  });

  // Review findings 1–2.
  it('the API is stable: a consumer effect on it runs once while toasts come and go', async () => {
    const user = userEvent.setup();
    renderToasts();
    act(() => {
      api.show({ message: 'A' });
      api.show({ message: 'B' });
    });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(visibleToast()).toHaveTextContent('B'));
    act(() => api.dismiss());
    await waitFor(() => expect(visibleToast()).toBeNull());
    expect(seen).toHaveLength(1);
  });

  it('an API captured before the toast was shown still dismisses the current head', async () => {
    renderToasts();
    const early = api; // captured while the queue was empty
    act(() => {
      api.show({ message: 'First' });
      api.show({ message: 'Second' });
    });
    act(() => early.dismiss());
    await waitFor(() => expect(visibleToast()).toHaveTextContent('Second'));
    let id = 0;
    act(() => void (id = api.show({ message: 'Third' })));
    act(() => early.dismiss(id)); // queued id, via the early API
    act(() => early.dismiss());
    await waitFor(() => expect(visibleToast()).toBeNull());
    expect(screen.queryByText('Third')).toBeNull();
  });

  it('the dismissed head stays rendered during its exit transition, then leaves the queue', async () => {
    renderToasts(undefined, false); // real (non-zero) transition durations
    act(() => {
      api.show({ message: 'Leaving' });
      api.show({ message: 'Next' });
    });
    act(() => api.dismiss());
    // Not announced any more, but still on screen while it animates out; "Next" waits.
    expect(polite()).toBeEmptyDOMElement();
    expect(visibleToast()).toHaveTextContent('Leaving');
    expect(screen.queryByText('Next')).toBeNull();
    await waitFor(() => expect(visibleToast()).toHaveTextContent('Next'));
    expect(polite()).toHaveTextContent('Next');
  });

  it('useToast outside the provider throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    vi.restoreAllMocks();
  });
});
