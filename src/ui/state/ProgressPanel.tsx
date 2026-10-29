// Long-running work (catalog sync, list import) — docs/UX_UI.md §5 "Long sync: bar with step and
// count, cancelable" ("Loading movies… 12 400").
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef } from 'react';
import { numberFormat as activeNumberFormat, t } from '@/i18n';
import { visuallyHidden } from './visuallyHidden';

export interface ProgressPanelProps {
  /** Current step, already translated (e.g. "Loading movies…"). */
  phase: string;
  /** Items processed so far. */
  count?: number | undefined;
  /** Expected total; with `count` it makes the bar determinate. */
  total?: number | undefined;
  /** Shows a Cancel button. */
  onCancel?: (() => void) | undefined;
  /** Cancellation requested: the button is disabled and reads "Cancelling…". */
  cancelling?: boolean;
}

// Active locale at call time (UX-06 AC5).
const numberFormat = { format: (value: number) => activeNumberFormat().format(value) };

export function ProgressPanel({ phase, count, total, onCancel, cancelling }: ProgressPanelProps) {
  const phaseId = useId();
  const liveRef = useRef<HTMLDivElement>(null);
  // The live region is mounted empty and only then filled (a region inserted together with its
  // text is not reliably announced); React renders no children into it.
  useEffect(() => {
    if (liveRef.current) liveRef.current.textContent = phase;
  }, [phase]);
  const determinate = count !== undefined && total !== undefined && total > 0;
  const percent = determinate ? Math.min(100, Math.max(0, (count / total) * 100)) : undefined;
  let countText: string | undefined;
  if (determinate)
    countText = t.state.progress.countOf(numberFormat.format(count), numberFormat.format(total));
  else if (count !== undefined) countText = t.state.progress.count(numberFormat.format(count));

  return (
    <Box
      role="group"
      aria-labelledby={phaseId}
      sx={{ p: 2, borderRadius: 2, bgcolor: 'background.paper' }}
    >
      {/* Only the phase is announced: the count changes too often for a live region. The
          visible label is hidden from assistive technology so the phase is exposed once; it
          still names the group and the bar (aria-labelledby reads hidden elements). */}
      <Box ref={liveRef} role="status" sx={visuallyHidden} data-testid="progress-live" />
      <Typography id={phaseId} aria-hidden="true" variant="body1" sx={{ fontWeight: 600 }}>
        {phase}
      </Typography>
      <LinearProgress
        variant={determinate ? 'determinate' : 'indeterminate'}
        value={percent}
        aria-labelledby={phaseId}
        aria-valuetext={countText}
        sx={{ my: 1.5 }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 44 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {countText}
        </Typography>
        {onCancel && (
          <Button variant="outlined" onClick={onCancel} disabled={cancelling}>
            {cancelling ? t.state.cancelling : t.state.cancel}
          </Button>
        )}
      </Box>
    </Box>
  );
}
