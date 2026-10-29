// Add-local-M3U-file form (SRC-06): pick a file (AC1), confirm when it is over 50 MB (AC2), then
// save the source row (no URL, nothing in the vault) and read the file in the data worker through
// the same streaming parser and write as a URL list, with cancellable progress (bytes read and
// entries). The `File` is kept in memory only while this screen is open (for "Try again"); it is
// never stored. On failure another file can be picked, the import retried or the list deleted.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Source } from '@/core/db';
import { log } from '@/core/log';
import { t } from '@/i18n';
import { formatBytes } from '@/ui/format';
import { StateView, useToast } from '@/ui/state';
import { MAX_SOURCE_NAME_LENGTH } from '../sourceName';
import { TextInput } from '../xtream/TextInput';
import { isLargeFile, LargeFileDialog, M3uFilePicker } from './filePicker';
import { errorFailure, ImportProgressView, ImportSuccess, useM3uImport } from './importState';
import {
  runM3uFileImport,
  settleM3uImport,
  type RunM3uFileImport,
  type SettleM3uImport,
} from './runM3uImport';
import { saveM3uFileSource } from './saveM3uFileSource';
import { deleteM3uUrlSource } from './saveM3uUrlSource';

export interface M3uFileFormDeps {
  saveSource: typeof saveM3uFileSource;
  deleteSource: typeof deleteM3uUrlSource;
  runImport: RunM3uFileImport;
  /** After a cancel: waits for the worker to stop and returns the source row (real outcome). */
  settleImport: SettleM3uImport;
}

const defaultDeps: M3uFileFormDeps = {
  saveSource: saveM3uFileSource,
  deleteSource: deleteM3uUrlSource,
  runImport: runM3uFileImport,
  settleImport: settleM3uImport,
};

export interface M3uFileFormProps {
  /** Where to go once the list is imported. */
  doneTo: string;
  deps?: Partial<M3uFileFormDeps>;
}

export function M3uFileForm({ doneTo, deps: depsOverride }: M3uFileFormProps) {
  const deps = { ...defaultDeps, ...depsOverride };
  const navigate = useNavigate();
  const toast = useToast();
  const text = t.sources.addM3uFile;
  const urlText = t.sources.addM3uUrl;
  const job = useM3uImport(deps.settleImport);
  const { step, failure, success, mounted } = job;
  const helpId = useId();

  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [name, setName] = useState('');
  /** The saved source while its first import has not succeeded (retry / delete). */
  const [source, setSource] = useState<Source | undefined>();
  /** AC2: a large file waiting for confirmation. */
  const [askLarge, setAskLarge] = useState(false);
  /** The large file the user already agreed to import. */
  const confirmedLarge = useRef<File | undefined>(undefined);
  /** Synchronous guard: `busy` only changes on the next render, a double submit is quicker. */
  const importing = useRef(false);

  const pickButton = useRef<HTMLButtonElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const busy = step !== undefined;

  function pick(picked: File) {
    setFile(picked);
    setFileError(undefined);
  }

  async function importFile(target: File) {
    if (importing.current) return;
    importing.current = true;
    try {
      await saveAndImport(target);
    } finally {
      importing.current = false;
    }
  }

  async function saveAndImport(target: File) {
    let saved = source;
    if (!saved) {
      job.setFailure(undefined);
      job.setStep('saving');
      try {
        saved = await deps.saveSource({ name, fileName: target.name });
      } catch (error) {
        log.warn('Saving the M3U file source failed', { error });
        if (!mounted.current) return;
        job.setStep(undefined);
        job.setFailure(errorFailure(error));
        return;
      }
      if (!mounted.current) return;
      setSource(saved);
    }
    const id = saved.id;
    const imported = await job.run(saved, 'read', (options) => deps.runImport(id, target, options));
    if (imported) setSource(undefined);
  }

  /** Import (or retry) with the chosen file, after the large-file confirmation when needed. */
  function start() {
    if (busy || importing.current) return;
    if (!file) {
      setFileError(text.validation.fileRequired);
      job.setFailure(undefined);
      pickButton.current?.focus();
      return;
    }
    if (isLargeFile(file) && confirmedLarge.current !== file) {
      setAskLarge(true);
      return;
    }
    void importFile(file);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    start();
  }

  function confirmLarge() {
    setAskLarge(false);
    confirmedLarge.current = file;
    if (file) void importFile(file);
  }

  async function deleteList() {
    if (!source || busy) return;
    try {
      await deps.deleteSource(source);
    } catch (error) {
      log.warn('Deleting the M3U file source failed', { error });
      if (mounted.current) job.setFailure(errorFailure(error));
      return;
    }
    if (!mounted.current) return;
    setSource(undefined);
    job.setFailure(undefined);
    toast.show({ message: urlText.toasts.deleted });
    pickButton.current?.focus();
  }

  function finish() {
    toast.show({ message: urlText.toasts.imported });
    void navigate(doneTo);
  }

  if (success) {
    return <ImportSuccess success={success} onContinue={finish} headingRef={successRef} />;
  }

  const describedBy = `${helpId}-file ${helpId}-help`;

  return (
    <Box component="form" noValidate onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <Box role="group" aria-labelledby={`${helpId}-label`}>
          <Typography variant="subtitle2" component="p" id={`${helpId}-label`} sx={{ mb: 1 }}>
            {text.fields.file}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <M3uFilePicker
              label={file ? text.fields.change : text.fields.choose}
              onPick={pick}
              disabled={busy}
              describedBy={describedBy}
              buttonRef={pickButton}
            />
            <Typography
              id={`${helpId}-file`}
              data-testid="m3u-file-chosen"
              sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
              color={file ? 'text.primary' : 'text.secondary'}
            >
              {file ? text.fields.chosen(file.name, formatBytes(file.size)) : text.fields.none}
            </Typography>
          </Box>
          <FormHelperText id={`${helpId}-help`} error={fileError !== undefined}>
            {fileError ?? text.fields.fileHelp}
          </FormHelperText>
        </Box>
        <TextInput
          id="m3u-file-name"
          name="name"
          label={text.fields.name}
          value={name}
          onChange={setName}
          helperText={text.fields.nameHelp}
          disabled={busy || source !== undefined}
          autoComplete="off"
          htmlInput={{ maxLength: MAX_SOURCE_NAME_LENGTH }}
        />

        {busy ? (
          <ImportProgressView
            fromFile
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
                <>
                  <Button type="submit" variant="contained">
                    {urlText.retry}
                  </Button>
                  {source && (
                    <Button variant="outlined" color="error" onClick={() => void deleteList()}>
                      {urlText.delete}
                    </Button>
                  )}
                </>
              }
            />
          </Box>
        )}
      </Stack>
      <LargeFileDialog
        open={askLarge}
        size={file?.size ?? 0}
        onConfirm={confirmLarge}
        onCancel={() => setAskLarge(false)}
      />
    </Box>
  );
}
