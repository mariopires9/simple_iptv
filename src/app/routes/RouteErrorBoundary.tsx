// Route-level error boundaries (FND-04, UX-02). They never show the error itself — not even in a
// "Details" disclosure: a render error message may echo list data that `redact()` does not know
// about. Logging happens once per error in the RouterProvider `onError` handler (router.tsx).
import Button from '@mui/material/Button';
import { isRouteErrorResponse, Link, useLocation, useNavigate, useRouteError } from 'react-router';
import { t } from '@/i18n';
import { StateView } from '@/ui/state';
import { isChunkLoadError, page } from '../chunkReload';
import { NotFoundScreen } from './NotFoundScreen';
import { FullScreen } from './FullScreen';

/** Rendered in place of a failing screen, inside the AppShell (the navigation stays usable). */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  // Defensive: unmatched paths are caught by the `*` route, but a thrown 404 lands here.
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundScreen />;

  return (
    <StateView
      variant="error"
      headingLevel={1}
      title={t.routes.error.title}
      message={t.routes.error.message}
      actions={
        <>
          {/* A chunk that failed to load is most likely gone after a redeploy: only a full
              reload fetches the new index.html. Otherwise a new navigation to the same
              location clears the error state and renders the screen again. */}
          <Button
            variant="contained"
            onClick={() => {
              if (isChunkLoadError(error)) page.reload();
              else void navigate({ pathname, search, hash }, { replace: true });
            }}
          >
            {t.routes.error.retry}
          </Button>
          <Button variant="outlined" component={Link} to="/">
            {t.routes.goHome}
          </Button>
        </>
      }
    />
  );
}

/** Top-level boundary: the AppShell itself failed, so render full screen. */
export function RootErrorBoundary() {
  return (
    <FullScreen>
      <RouteErrorBoundary />
    </FullScreen>
  );
}
