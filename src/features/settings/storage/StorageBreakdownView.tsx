// Settings › Storage › "What is stored" (STO-01 AC1): per list, then the app-wide parts. Every size
// is an estimate, shown as "about …".
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { intlNumberFormat, t } from '@/i18n';
import { formatBytes } from '@/ui/format';
import type { StorageBreakdown } from './storageUsage';

export type BreakdownState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; data: StorageBreakdown };

const integer = intlNumberFormat();

function Row({ label, bytes, detail }: { label: string; bytes: number; detail?: string }) {
  const text = t.settings.storage.breakdown;
  return (
    <Box component="li" sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, py: 0.25 }}>
      <Typography component="span" sx={{ flex: '1 1 12rem' }}>
        {label}
        {detail !== undefined && (
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            {detail}
          </Typography>
        )}
      </Typography>
      <Typography component="span" color="text.secondary">
        {text.about(formatBytes(bytes))}
      </Typography>
    </Box>
  );
}

const listSx = { listStyle: 'none', m: 0, p: 0 } as const;

export function StorageBreakdownView({ state }: { state: BreakdownState }) {
  const text = t.settings.storage.breakdown;
  return (
    <Box>
      <Typography variant="subtitle1" component="h3">
        {text.title}
      </Typography>
      {state.kind === 'loading' && (
        <Stack direction="row" spacing={1} role="status" sx={{ mt: 1, alignItems: 'center' }}>
          <CircularProgress size={20} aria-hidden />
          <Typography color="text.secondary">{text.loading}</Typography>
        </Stack>
      )}
      {state.kind === 'failed' && (
        <Typography color="text.secondary" role="status">
          {text.failed}
        </Typography>
      )}
      {state.kind === 'ready' && (
        <Stack spacing={1.5} sx={{ mt: 1 }} data-testid="storage-breakdown">
          {state.data.lists.length === 0 && (
            <Typography color="text.secondary">{text.noLists}</Typography>
          )}
          {state.data.lists.map((list) => (
            <Box key={list.sourceId}>
              <Typography variant="subtitle2" component="h4">
                {list.name}
              </Typography>
              <Box component="ul" sx={listSx}>
                <Row
                  label={text.catalogue}
                  bytes={list.catalogue.bytes}
                  detail={text.catalogueCounts(
                    integer().format(list.catalogue.live),
                    integer().format(list.catalogue.movie),
                    integer().format(list.catalogue.series),
                    integer().format(list.catalogue.episodes),
                  )}
                />
                <Row label={text.search} bytes={list.search.bytes} />
                <Row label={text.guide} bytes={list.guide.bytes} />
              </Box>
            </Box>
          ))}
          <Box>
            <Typography variant="subtitle2" component="h4">
              {text.appTitle}
            </Typography>
            <Box component="ul" sx={listSx}>
              <Row label={text.appFiles} bytes={state.data.appFiles} detail={text.appFilesHint} />
              {state.data.otherCaches > 0 && (
                <Row label={text.otherCaches} bytes={state.data.otherCaches} />
              )}
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {text.images} {text.note}
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
