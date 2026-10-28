import type { SxProps, Theme } from '@mui/material/styles';

// Local copy on purpose: MUI's `visuallyHidden` lives in `@mui/utils`, a transitive dependency
// that package.json does not declare.
/** Hidden on screen, still read by screen readers (the usual "sr-only" pattern). */
export const visuallyHidden: SxProps<Theme> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
