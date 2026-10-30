// Larger focus ring while the D-pad / keyboard is in use (UX-05): read from across a room, the
// theme's 2 px ring is easy to lose. Only the width and offset change; the colour stays the theme's
// `focusRing` token. On only while `<html data-input="dpad">` (installDpadNavigation).
import GlobalStyles from '@mui/material/GlobalStyles';
import { INPUT_ATTRIBUTE } from './installDpadNavigation';

/** Ring of the D-pad mode (px). */
export const DPAD_FOCUS_RING = { width: 4, offset: 3 } as const;

const ON = `html[${INPUT_ATTRIBUTE}="dpad"]`;

const styles = {
  [`${ON} :focus-visible, ${ON} .Mui-focusVisible`]: {
    outlineWidth: `${DPAD_FOCUS_RING.width}px`,
    outlineOffset: `${DPAD_FOCUS_RING.offset}px`,
  },
} as const;

export function DpadFocusStyles() {
  return <GlobalStyles styles={styles} />;
}
