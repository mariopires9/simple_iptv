// React bindings of the session's active list (`@/core/session`, SRC-08 AC4).
import { useActiveSource } from '@/ui/hooks/useActiveSource';

export { useActiveSource };
export {
  forgetActiveSource,
  refreshActiveSource,
  setActiveSource,
  type ActiveSourceSnapshot,
} from '@/core/session';

/** The effective active list id (`undefined` while unknown or when there is no list). */
export function useActiveSourceId(): string | undefined {
  return useActiveSource().id;
}
