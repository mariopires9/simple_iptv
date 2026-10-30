// D-pad / TV remote navigation (UX-05).
export { DpadFocusStyles, DPAD_FOCUS_RING } from './DpadFocusStyles';
export {
  initialFocusTarget,
  installDpadNavigation,
  INPUT_ATTRIBUTE,
} from './installDpadNavigation';
export type { DpadOptions } from './installDpadNavigation';
export { channelKeyOf, directionOf, isBackAlias, type Direction, type KeyLike } from './keys';
export { DPAD_SCOPE_ATTRIBUTE, findNext, pickInDirection, type Rect } from './spatial';
