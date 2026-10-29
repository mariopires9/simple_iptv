// Add-M3U-URL form (SRC-05): validation, Xtream `get.php` detection (→ Xtream form, prefilled in
// memory), then save (vault + source row) and import in the data worker with cancellable progress
// (bytes and entries). On failure the list can be imported again or deleted. A list the browser
// cannot download (CORS / mixed content) points to the local-file import (SRC-06).
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { detectXtreamPlaylistUrl } from '@/providers/m3u';
import { StateView, useToast } from '@/ui/state';
import { MAX_SOURCE_NAME_LENGTH } from '../xtream/saveXtreamSource';
import { stashXtreamPrefill } from '../xtream/prefill';
import { TextInput } from '../xtream/TextInput';
import {
  errorFailure,
  FixesList,
  ImportProgressView,
  ImportSuccess,
  useM3uImport,
} from './importState';
import {
  runM3uImport,
  settleM3uImport,
  type RunM3uImport,
  type SettleM3uImport,
} from './runM3uImport';
import { deleteM3uUrlSource, saveM3uUrlSource } from './saveM3uUrlSource';
import { validateM3uUrlForm, type M3uUrlFormValues } from './validate';

export interface M3uUrlFormDeps {
  saveSource: typeof saveM3uUrlSource;
  deleteSource: typeof deleteM3uUrlSource;
  runImport: RunM3uImport;
  /** After a cancel: waits for the worker to stop and returns the source row (real outcome). */
  settleImport: SettleM3uImport;
}

const defaultDeps: M3uUrlFormDeps = {
  saveSource: saveM3uUrlSource,
  deleteSource: deleteM3uUrlSource,
  runImport: runM3uImport,
  settleImport: settleM3uImport,
};

export interface M3uUrlFormProps {
  /** Where to go once the list is imported. */
  doneTo: string;
  /** The Xtream form to offer for `get.php` URLs. */
  xtreamTo: string;
  /** The local-file import to offer when the browser cannot download the list (SRC-06). */
  fileTo: string;
  deps?: Partial<M3uUrlFormDeps>;
}

const EMPTY: M3uUrlFormValues = { url: '', name: '' };

export function M3uUrlForm({ doneTo, xtreamTo, fileTo, deps: depsOverride }: M3uUrlFormProps) {
  const deps = { ...defaultDeps, ...depsOverride };
  const navigate = useNavigate();
  const toast = useToast();
  const text = t.sources.addM3uUrl;
  const job = useM3uImport(deps.settleImport);
  const { step, failure, success, mounted } = job;

  const [values, setValues] = useState<M3uUrlFormValues>(EMPTY);
  const [urlError, setUrlError] = useState<string | undefined>();
  /** The saved source while its first import has not succeeded (retry / delete). */
  const [source, setSource] = useState<Source | undefined>();

  const urlInput = useRef<HTMLInputElement | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const xtream = useMemo(
    () => (source ? undefined : detectXtreamPlaylistUrl(values.url)),
    [values.url, source],
  );
  const busy = step !== undefined;
  const locked = busy || source !== undefined;

  const setField = (field: keyof M3uUrlFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'url' && urlError !== undefined) setUrlError(undefined);
  };

  async function runImport(target: Source) {
    const imported = await job.run(target, 'download', (options) =>
      deps.runImport(target.id, options),
    );
    if (imported) setSource(undefined);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const validation = validateM3uUrlForm(values);
    if (!validation.ok) {
      setUrlError(validation.error);
      job.setFailure(undefined);
      urlInput.current?.focus();
      return;
    }
    setUrlError(undefined);
    job.setFailure(undefined);
    job.setStep('saving');
    let saved: Source;
    try {
      saved = await deps.saveSource({
        name: values.name,
        host: validation.host,
        url: validation.url,
      });
    } catch (error) {
      log.warn('Saving the M3U source failed', { error });
      if (!mounted.current) return;
      job.setStep(undefined);
      job.setFailure(errorFailure(error));
      return;
    }
    if (!mounted.current) return;
    setSource(saved);
    await runImport(saved);
  }

  async function deleteList() {
    if (!source || busy) return;
    try {
      await deps.deleteSource(source);
    } catch (error) {
      log.warn('Deleting the M3U source failed', { error });
      if (mounted.current) job.setFailure(errorFailure(error));
      return;
    }
    if (!mounted.current) return;
    setSource(undefined);
    job.setFailure(undefined);
    toast.show({ message: text.toasts.deleted });
    urlInput.current?.focus();
  }

  function openXtreamForm() {
    if (!xtream) return;
    const state = stashXtreamPrefill({
      server: xtream.server,
      username: xtream.username,
      password: xtream.password,
      name: values.name,
    });
    void navigate(xtreamTo, { state });
  }

  function finish() {
    toast.show({ message: text.toasts.imported });
    void navigate(doneTo);
  }

  if (success) {
    return <ImportSuccess success={success} onContinue={finish} headingRef={successRef} />;
  }

  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <TextInput
          id="m3u-url"
          name="url"
          label={text.fields.url}
          value={values.url}
          onChange={setField('url')}
          error={urlError !== undefined}
          helperText={urlError ?? text.fields.urlHelp}
          disabled={locked}
          required
          autoComplete="off"
          inputRef={(el) => {
            urlInput.current = el;
          }}
          htmlInput={{
            inputMode: 'url',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
          }}
        />
        <TextInput
          id="m3u-name"
          name="name"
          label={text.fields.name}
          value={values.name}
          onChange={setField('name')}
          helperText={text.fields.nameHelp}
          disabled={locked}
          autoComplete="off"
          htmlInput={{ maxLength: MAX_SOURCE_NAME_LENGTH }}
        />

        {xtream && !busy && (
          <Box
            data-testid="xtream-suggestion"
            sx={{
              display: 'flex',
              gap: 1.5,
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'info.main',
            }}
          >
            <InfoOutlined aria-hidden sx={{ color: 'info.main', mt: 0.25 }} />
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{text.xtreamSuggestion.title}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {text.xtreamSuggestion.message}
              </Typography>
              <Button variant="contained" onClick={openXtreamForm}>
                {text.xtreamSuggestion.action}
              </Button>
            </Box>
          </Box>
        )}

        {busy ? (
          <ImportProgressView
            fromFile={false}
            step={step}
            progress={job.progress}
            cancelling={job.cancelling}
            onCancel={job.cancel}
          />
        ) : (
          source === undefined && (
            <Button type="submit" variant="contained" size="large" sx={{ minHeight: 44 }}>
              {text.submit}
            </Button>
          )
        )}

        {failure && !busy && (
          <Box ref={failureRef} tabIndex={-1} sx={{ outline: 'none' }} data-testid="m3u-failure">
            <StateView
              variant={failure.variant}
              title={failure.title}
              message={failure.message}
              details={failure.details}
              actions={
                source ? (
                  <>
                    <Button variant="contained" onClick={() => void runImport(source)}>
                      {text.retry}
                    </Button>
                    <Button variant="outlined" color="error" onClick={() => void deleteList()}>
                      {text.delete}
                    </Button>
                  </>
                ) : (
                  <Button type="submit" variant="contained">
                    {text.retry}
                  </Button>
                )
              }
            />
            <FixesList fixes={failure.fixes} />
            {failure.localFile && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {text.localFile.message}
                </Typography>
                <Button component={Link} to={fileTo} sx={{ mt: 0.5, ml: -1 }}>
                  {text.localFile.action}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
