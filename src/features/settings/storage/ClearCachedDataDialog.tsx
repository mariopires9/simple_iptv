// "Clear cached data" dialog (STO-01 AC2): one checkbox per clearable part, each with its
// estimated size and what happens afterwards. Default: guide + search indexes (+ other cached
// files when there are any); no list's catalogue. While clearing the dialog cannot be dismissed.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Typography from '@mui/material/Typography';
import { useId, useRef, useState } from 'react';
import { t } from '@/i18n';
import { formatBytes } from '@/ui/format';
import { ProgressPanel } from '@/ui/state';
import { hasSelection, type ClearResult, type ClearSelection } from './clearCachedData';
import { catalogueBytes, clearableSizes, type StorageBreakdown } from './storageUsage';

export interface ClearCachedDataDialogProps {
  open: boolean;
  breakdown: StorageBreakdown;
  clear: (selection: ClearSelection) => Promise<ClearResult>;
  /** A list's catalogue was cleared: the app restarts (stale in-memory stores). */
  restart: () => void;
  /** Cleared without a restart. */
  onCleared: () => void;
  onClose: () => void;
}

interface OptionProps {
  label: string;
  hint?: string;
  bytes: number;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
}

function Option({ label, hint, bytes, checked, disabled, onChange, indeterminate }: OptionProps) {
  const hintId = useId();
  const text = t.settings.storage.clear;
  return (
    <Box sx={{ mb: 1 }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            indeterminate={indeterminate ?? false}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: hint === undefined ? {} : { 'aria-describedby': hintId } }}
          />
        }
        label={`${label} (${text.size(formatBytes(bytes))})`}
      />
      {hint !== undefined && (
        <Typography id={hintId} variant="body2" color="text.secondary" sx={{ ml: 4, mt: -0.5 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function ClearCachedDataDialog({
  open,
  breakdown,
  clear,
  restart,
  onCleared,
  onClose,
}: ClearCachedDataDialogProps) {
  const text = t.settings.storage.clear;
  const titleId = useId();
  const messageId = useId();
  const sizes = clearableSizes(breakdown);
  const [guide, setGuide] = useState(true);
  const [search, setSearch] = useState(true);
  const [otherCaches, setOtherCaches] = useState(sizes.otherCaches > 0);
  const [catalogue, setCatalogue] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<'select' | 'clearing' | 'failed'>('select');
  const running = useRef(false);
  const clearing = phase === 'clearing';

  const selection: ClearSelection = {
    guide,
    search,
    otherCaches,
    catalogue: breakdown.lists.filter((l) => catalogue.has(l.sourceId)).map((l) => l.sourceId),
  };
  const allIds = breakdown.lists.map((l) => l.sourceId);
  const allSelected = allIds.length > 0 && allIds.every((id) => catalogue.has(id));
  const someSelected = allIds.some((id) => catalogue.has(id));

  const toggleList = (id: string, checked: boolean) => {
    const next = new Set(catalogue);
    if (checked) next.add(id);
    else next.delete(id);
    setCatalogue(next);
  };

  const close = () => {
    if (!clearing) onClose();
  };

  async function run() {
    // Synchronous guard: a double click must not start two clears.
    if (running.current || !hasSelection(selection)) return;
    running.current = true;
    setPhase('clearing');
    let result: ClearResult;
    try {
      result = await clear(selection);
    } finally {
      running.current = false;
    }
    if (result.clearedLists.length > 0) {
      restart();
      return;
    }
    if (result.failed.length > 0) {
      setPhase('failed');
      return;
    }
    onCleared();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id={titleId}>{text.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={messageId} sx={{ mb: 2 }}>
          {text.message}
        </DialogContentText>
        {phase === 'failed' && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {text.failed}
          </Alert>
        )}
        <FormGroup>
          <Option
            label={text.guide}
            hint={text.guideHint}
            bytes={sizes.guide}
            checked={guide}
            disabled={clearing}
            onChange={setGuide}
          />
          <Option
            label={text.search}
            hint={text.searchHint}
            bytes={sizes.search}
            checked={search}
            disabled={clearing}
            onChange={setSearch}
          />
          {sizes.otherCaches > 0 && (
            <Option
              label={text.otherCaches}
              hint={text.otherCachesHint}
              bytes={sizes.otherCaches}
              checked={otherCaches}
              disabled={clearing}
              onChange={setOtherCaches}
            />
          )}
        </FormGroup>
        {breakdown.lists.length > 0 && (
          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, mt: 1 }}>
            <Typography component="legend" variant="subtitle2">
              {text.catalogue}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {text.catalogueHint}
            </Typography>
            <FormGroup>
              {breakdown.lists.length > 1 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      disabled={clearing}
                      onChange={(event) =>
                        setCatalogue(new Set(event.target.checked ? allIds : []))
                      }
                    />
                  }
                  label={text.allLists}
                />
              )}
              {breakdown.lists.map((list) => (
                <Box key={list.sourceId} sx={{ ml: breakdown.lists.length > 1 ? 3 : 0 }}>
                  <Option
                    label={list.name}
                    {...(list.kind === 'm3u-file' ? { hint: text.fileListHint } : {})}
                    bytes={catalogueBytes(list)}
                    checked={catalogue.has(list.sourceId)}
                    disabled={clearing}
                    onChange={(checked) => toggleList(list.sourceId, checked)}
                  />
                </Box>
              ))}
            </FormGroup>
          </Box>
        )}
        {clearing && (
          <Box sx={{ mt: 2 }}>
            <ProgressPanel phase={text.clearing} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={clearing}>
          {t.state.cancel}
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => void run()}
          disabled={clearing || !hasSelection(selection)}
        >
          {text.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
