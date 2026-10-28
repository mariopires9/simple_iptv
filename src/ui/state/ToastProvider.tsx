// Toasts (UX-02): short feedback after an action. At most one is visible; the rest wait in a FIFO
// queue. Announcements go through two live regions that stay mounted for the provider's lifetime
// (regions inserted together with their text are not reliably announced): `role="status"`
// (polite) for info/success, `role="alert"` (assertive) for errors.
import Button from '@mui/material/Button';
import Snackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import Box from '@mui/material/Box';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@/i18n';
import { visuallyHidden } from './visuallyHidden';

export type ToastSeverity = 'info' | 'success' | 'error';

export interface ToastOptions {
  /** Already-translated text. */
  message: string;
  severity?: ToastSeverity;
  /** One action button (e.g. "Undo", "Try again"); pressing it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /**
   * Auto-hide delay (ms); `null` keeps the toast until dismissed. Defaults to 5 s, or 8 s for a
   * toast with an action (time to reach it with the keyboard). The timer pauses on hover/focus.
   */
  durationMs?: number | null;
}

export interface ToastApi {
  /** Queues a toast; returns its id. */
  show: (options: ToastOptions) => number;
  /** Dismisses a toast (visible or queued); without an id, the visible one. */
  dismiss: (id?: number) => void;
}

export const TOAST_DURATION_MS = 5000;
export const TOAST_WITH_ACTION_DURATION_MS = 8000;

interface QueuedToast extends ToastOptions {
  id: number;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

function durationOf(toast: QueuedToast): number | null {
  if (toast.durationMs !== undefined) return toast.durationMs;
  return toast.action ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<readonly QueuedToast[]>([]);
  /** Id of the visible toast once it was dismissed (it is leaving; the queue shifts on exit). */
  const [closedId, setClosedId] = useState<number | null>(null);
  const nextId = useRef(1);
  const current = queue[0];
  const open = current !== undefined && current.id !== closedId;

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setQueue((q) => [...q, { ...options, id }]);
    return id;
  }, []);

  const dismiss = useCallback(
    (id?: number) => {
      if (current === undefined) return;
      if (id === undefined || id === current.id) setClosedId(current.id);
      else setQueue((q) => q.filter((toast) => toast.id !== id));
    },
    [current],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const close = () => {
    if (current) setClosedId(current.id);
  };

  const handleClose = (_event: unknown, reason?: SnackbarCloseReason) => {
    // A click elsewhere must not swallow the message before it was read.
    if (reason === 'clickaway') return;
    close();
  };

  // After the exit transition the next toast (if any) comes in.
  const handleExited = () => {
    setQueue((q) => (q[0] !== undefined && q[0].id === closedId ? q.slice(1) : q));
  };

  const isError = current?.severity === 'error';
  const announced = open && current ? current.message : '';

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Box role="status" sx={visuallyHidden} data-testid="toast-polite">
        {isError ? '' : announced}
      </Box>
      <Box role="alert" sx={visuallyHidden} data-testid="toast-assertive">
        {isError ? announced : ''}
      </Box>
      <Snackbar
        key={current?.id}
        open={open}
        autoHideDuration={current ? durationOf(current) : null}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{
          transition: { onExited: handleExited },
          // The live regions above do the announcing; the visible toast is not a second one.
          content: {
            role: 'presentation',
            'aria-hidden': undefined,
            sx: isError ? { borderLeft: 4, borderColor: 'error.main' } : undefined,
          },
        }}
        message={current?.message}
        action={
          current && (
            <>
              {current.action && (
                <Button
                  color="primary"
                  size="small"
                  onClick={() => {
                    current.action?.onClick();
                    close();
                  }}
                >
                  {current.action.label}
                </Button>
              )}
              <Button color="inherit" size="small" onClick={close}>
                {t.state.dismiss}
              </Button>
            </>
          )
        }
      />
    </ToastContext.Provider>
  );
}
