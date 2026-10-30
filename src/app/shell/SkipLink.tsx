// "Skip to content" link (UX-03 AC3, WCAG 2.4.1): the first focusable element of every layout,
// hidden until it receives keyboard focus; activating it moves focus to the main landmark.
import Box from '@mui/material/Box';
import type { MouseEvent } from 'react';
import { t } from '@/i18n';
import { focusRing } from '@/ui/theme/tokens';

/** Id of the `<main>` landmark the skip link jumps to (AppShell and full-screen layouts). */
export const MAIN_CONTENT_ID = 'main-content';

/** Props for the `<main>` landmark: the skip link's target, focusable by script only. */
export const mainLandmarkProps = { id: MAIN_CONTENT_ID, tabIndex: -1 } as const;

/** Moves focus to the main landmark (the hash router owns the URL hash: no `#id` navigation). */
function skipToMain(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  document.getElementById(MAIN_CONTENT_ID)?.focus();
}

export function SkipLink() {
  return (
    <Box
      component="a"
      href={`#${MAIN_CONTENT_ID}`}
      onClick={skipToMain}
      sx={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 'tooltip',
        px: 2,
        py: 1.5,
        borderRadius: 2,
        bgcolor: 'background.paper',
        color: 'text.primary',
        typography: 'body1',
        fontWeight: 600,
        textDecoration: 'none',
        // Off screen until focused (still in the tab order and the accessibility tree).
        transform: 'translateY(-200%)',
        '&:focus': {
          transform: 'none',
          outline: `${focusRing.width}px solid`,
          outlineColor: 'tokens.focusRing',
          outlineOffset: `${focusRing.offset}px`,
        },
      }}
    >
      {t.nav.skipToContent}
    </Box>
  );
}
