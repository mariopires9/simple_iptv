// ui/state — system states and feedback (UX-02, docs/UX_UI.md §5). Features render loading,
// empty, no-results, error, offline, long-progress and toast feedback only through these.
export { StateView, type StateViewProps, type StateViewVariant } from './StateView';
export {
  DelayedLoading,
  useDelayedFlag,
  LOADING_DELAY_MS,
  type DelayedLoadingProps,
} from './DelayedLoading';
export {
  SkeletonContainer,
  ChannelListSkeleton,
  PosterGridSkeleton,
  DetailHeaderSkeleton,
  CHANNEL_ROW_HEIGHT,
  type SkeletonContainerProps,
  type PosterGridSkeletonProps,
} from './Skeletons';
export { ProgressPanel, type ProgressPanelProps } from './ProgressPanel';
export {
  ToastProvider,
  useToast,
  TOAST_DURATION_MS,
  TOAST_WITH_ACTION_DURATION_MS,
  type ToastApi,
  type ToastOptions,
  type ToastSeverity,
} from './ToastProvider';
export {
  describeError,
  errorDetails,
  MAX_DETAILS_LENGTH,
  type ErrorDescription,
  type SuggestedAction,
} from './describeError';
export { visuallyHidden } from './visuallyHidden';
