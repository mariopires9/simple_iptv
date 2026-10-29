// Filter field above the channel list (LIV-04, docs/UX_UI.md §4.3/§4.4). `Esc` clears it and
// `↓` moves into the results (the listbox keeps its own keyboard navigation).
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useId, type KeyboardEvent } from 'react';
import { t } from '@/i18n';
import { visuallyHidden } from '@/ui/state';

export interface ChannelFilterFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** DOM id of the listbox with the results. */
  listId: string;
  /** First focus: a good moment to start building the category's filter index. */
  onFocus?: () => void;
  /** The category's filter index could not be built (the list stays unfiltered). */
  failed?: boolean;
  onRetry?: () => void;
}

export function ChannelFilterField({
  value,
  onChange,
  listId,
  onFocus,
  failed = false,
  onRetry,
}: ChannelFilterFieldProps) {
  const hintId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      // Handled here: it must not also leave fullscreen or close a panel.
      event.preventDefault();
      event.stopPropagation();
      onChange('');
    } else if (event.key === 'ArrowDown') {
      const list = document.getElementById(listId);
      if (list) {
        event.preventDefault();
        list.focus();
      }
    }
  };
  return (
    <>
      <Box component="span" id={hintId} sx={visuallyHidden}>
        {t.live.filter.hint}
      </Box>
      <TextField
        size="small"
        fullWidth
        type="search"
        value={value}
        placeholder={t.live.filter.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        autoComplete="off"
        slotProps={{
          htmlInput: {
            'aria-label': t.live.filter.label,
            'aria-describedby': hintId,
            'aria-controls': listId,
            spellCheck: false,
            enterKeyHint: 'search',
          },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded aria-hidden fontSize="small" />
              </InputAdornment>
            ),
            endAdornment:
              value !== '' ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    edge="end"
                    aria-label={t.live.filter.clear}
                    onClick={() => onChange('')}
                  >
                    <CloseRounded fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
          },
        }}
        sx={{
          flexShrink: 0,
          // The browser's own clear "x" of search fields; ours is the button above.
          '& input::-webkit-search-cancel-button': { display: 'none' },
        }}
      />
      {failed && (
        <Alert
          severity="error"
          role="alert"
          data-testid="filter-error"
          sx={{ py: 0, flexShrink: 0 }}
          action={
            onRetry && (
              <Button color="inherit" size="small" onClick={onRetry}>
                {t.state.actions.retry}
              </Button>
            )
          }
        >
          {t.live.filter.failed}
        </Alert>
      )}
    </>
  );
}
