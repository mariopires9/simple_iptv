// Channel logo with an initials fallback (LIV-01 AC3, docs/UX_UI.md §4.6: 40×40 logo).
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { useState } from 'react';
import { colorsForName } from '@/ui/colorHash';
import { isLoadableImage } from '@/ui/images';
import { avatarPalette, radii } from '@/ui/theme/tokens';

export const AVATAR_SIZE = 40;

/** Up to two initials: the first letter or digit of the first two words. */
export function initialsOf(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '')
    .slice(0, 2);
  const initials = words.map((w) => Array.from(w)[0] ?? '').join('');
  return initials === '' ? '?' : initials.toLocaleUpperCase();
}

export interface ChannelAvatarProps {
  name: string;
  logo?: string | undefined;
}

/** Decorative: the channel name is always next to it, so the image has an empty `alt`. */
export function ChannelAvatar({ name, logo }: ChannelAvatarProps) {
  const theme = useTheme();
  // The logo that failed to load: a new `logo` (e.g. a recycled row) gets its own attempt.
  const [failedLogo, setFailedLogo] = useState<string>();
  const failed = failedLogo !== undefined && failedLogo === logo;
  const box = {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    flexShrink: 0,
    borderRadius: `${radii.sm}px`,
  } as const;

  if (!failed && isLoadableImage(logo)) {
    return (
      <Box
        component="img"
        src={logo}
        alt=""
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedLogo(logo)}
        sx={{ ...box, objectFit: 'contain', bgcolor: 'tokens.surface2' }}
      />
    );
  }
  const colors = colorsForName(name, avatarPalette[theme.palette.mode]);
  return (
    <Box
      aria-hidden="true"
      data-testid="channel-initials"
      sx={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: colors.bg,
        color: colors.fg,
        typography: 'caption',
        fontWeight: 700,
      }}
    >
      {initialsOf(name)}
    </Box>
  );
}
