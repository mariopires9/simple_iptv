// Seek bar (PLY-02 AC1–2): VOD position or the DVR window of a live stream. While dragging, the
// thumb follows the pointer and the media is only seeked on release (one seek per gesture).
import Slider from '@mui/material/Slider';
import { useState } from 'react';
import { t } from '@/i18n';
import { formatTime } from './formatTime';

export interface ProgressBarProps {
  /** Current position (media time, seconds). */
  value: number;
  /** Seekable window (media time, seconds). */
  min: number;
  max: number;
  onSeek: (time: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ProgressBar({ value, min, max, onSeek }: ProgressBarProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = clamp(dragging ?? value, min, max);
  return (
    <Slider
      size="small"
      min={min}
      max={max}
      step={1}
      shiftStep={10}
      value={shown}
      aria-label={t.player.controls.seek}
      getAriaValueText={(v) => t.player.timeOf(formatTime(v - min), formatTime(max - min))}
      onChange={(_, v) => setDragging(v)}
      onChangeCommitted={(_, v) => {
        setDragging(null);
        onSeek(v);
      }}
      sx={{ color: 'primary.main', mx: 1 }}
    />
  );
}
