// Edit a saved list (SRC-08 AC2): Xtream lists reuse the add form in edit mode (rename, server,
// username, password — re-tested before applying); M3U lists can be renamed and get a program
// guide section (EPG-02).
import ArrowBack from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { DelayedLoading, StateView, errorDetails, useToast } from '@/ui/state';
import { EpgSettings } from './EpgSettings';
import { renameSource } from './manage';
import { MAX_SOURCE_NAME_LENGTH } from './xtream/saveXtreamSource';
import { TextInput } from './xtream/TextInput';
import { XtreamSourceForm, type XtreamSourceFormDeps } from './xtream/XtreamSourceForm';

const LISTS_PATH = '/settings/sources';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; source: Source };

export interface EditSourceScreenProps {
  /** Overrides for tests (Xtream form). */
  xtreamDeps?: Partial<XtreamSourceFormDeps>;
}

/** `/settings/sources/:sourceId/edit`. */
export function EditSourceScreen({ xtreamDeps }: EditSourceScreenProps = {}) {
  const { sourceId = '' } = useParams();
  const text = t.sources.edit;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    sourcesRepo.get(sourceId).then(
      (source) => {
        if (current) setState(source ? { status: 'ready', source } : { status: 'missing' });
      },
      (error: unknown) => {
        if (current) setState({ status: 'error', error });
      },
    );
    return () => {
      current = false;
    };
  }, [sourceId, attempt]);

  let content;
  switch (state.status) {
    case 'loading':
      content = <DelayedLoading>{null}</DelayedLoading>;
      break;
    case 'missing':
      content = (
        <StateView
          variant="empty"
          title={text.notFound.title}
          message={text.notFound.message}
          actions={
            <Button variant="contained" component={Link} to={LISTS_PATH}>
              {t.sources.myLists.title}
            </Button>
          }
        />
      );
      break;
    case 'error':
      content = (
        <StateView
          variant="error"
          title={text.loadError.title}
          message={text.loadError.message}
          details={errorDetails(state.error)}
          actions={
            <Button
              variant="contained"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              {t.state.actions.retry}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      content =
        state.source.kind === 'xtream' ? (
          <XtreamSourceForm doneTo={LISTS_PATH} editing={state.source} deps={xtreamDeps} />
        ) : (
          <>
            <RenameForm source={state.source} />
            <EpgSettings source={state.source} />
          </>
        );
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Button component={Link} to={LISTS_PATH} startIcon={<ArrowBack />} sx={{ mb: 1, ml: -1 }}>
        {text.back}
      </Button>
      <Typography variant="h1" gutterBottom>
        {text.title}
      </Typography>
      {state.status === 'ready' && (
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {t.sources.myLists.kinds[state.source.kind]}
        </Typography>
      )}
      {content}
    </Box>
  );
}

/** Rename an M3U list (its address is not editable: remove and add it again). */
function RenameForm({ source }: { source: Source }) {
  const text = t.sources.edit;
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(source.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await renameSource(source.id, name);
      if (!mounted.current) return;
      toast.show({ message: t.sources.myLists.toasts.updated });
      void navigate(LISTS_PATH);
    } catch (failure) {
      log.warn('Renaming the source failed', { error: failure });
      if (!mounted.current) return;
      setSaving(false);
      setError(failure);
    }
  }

  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <TextInput
          id="source-name"
          name="name"
          label={text.name}
          value={name}
          onChange={setName}
          helperText={text.nameHelp}
          disabled={saving}
          autoComplete="off"
          htmlInput={{ maxLength: MAX_SOURCE_NAME_LENGTH }}
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={saving}
          sx={{ minHeight: 44 }}
        >
          {text.save}
        </Button>
        {error !== undefined && (
          <StateView
            variant="error"
            title={t.state.errors.unknown.title}
            message={t.state.errors.unknown.message}
            details={errorDetails(error)}
          />
        )}
      </Stack>
    </Box>
  );
}
