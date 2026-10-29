// "Protected" badge (UX-07): marks DRM-flagged or DASH items, which this app never plays, on
// poster cards, channel rows, episode rows and the details hero. The visible word is short; the
// accessible name is the full "Protected content (DRM/DASH)".
import LockRounded from '@mui/icons-material/LockRounded';
import Box from '@mui/material/Box';
import { t } from '@/i18n';
import { visuallyHidden } from '@/ui/state';
import { radii } from '@/ui/theme/tokens';

export interface ProtectedBadgeProps {
  /** Pinned over the top-left corner of a poster (its parent must be positioned). */
  overlay?: boolean;
  /**
   * Default: the badge is an image named "Protected content (DRM/DASH)". `false` inside a link or
   * row whose name already carries `ProtectedNote` (the badge is then decorative).
   */
  labelled?: boolean;
}

export function ProtectedBadge({ overlay = false, labelled = true }: ProtectedBadgeProps) {
  const text = t.state.protectedContent;
  const a11y = labelled
    ? ({ role: 'img', 'aria-label': text.label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <Box
      component="span"
      data-testid="protected-badge"
      title={text.label}
      {...a11y}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.25,
        borderRadius: `${radii.pill}px`,
        bgcolor: 'tokens.surface3',
        color: 'text.primary',
        typography: 'caption',
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        verticalAlign: 'middle',
        ...(overlay ? { position: 'absolute', top: 6, left: 6, zIndex: 1, boxShadow: 1 } : {}),
      }}
    >
      <LockRounded aria-hidden sx={{ fontSize: '1em' }} />
      {text.badge}
    </Box>
  );
}

/**
 * Visually hidden ", Protected content (DRM/DASH)" appended to a card's or row's name; with
 * `unplayable`, the whole explanation (a row whose Play is disabled).
 */
export function ProtectedNote({ unplayable = false }: { unplayable?: boolean }) {
  const text = t.state.protectedContent;
  return (
    <Box component="span" sx={visuallyHidden}>
      {`, ${unplayable ? text.unplayable : text.label}`}
    </Box>
  );
}
