// Program guide of an M3U list (EPG-02/EPG-03): optional manual XMLTV address (used before the
// list's own `url-tvg`), the last import's outcome with the share of channels that have a guide
// (EPG-03 AC4), and a manual "Update guide" (the import runs in the data worker).
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sourcesRepo, type Source } from '@/core/db';
import { log } from '@/core/log';
import { parseExternalUrl } from '@/core/net';
import { activeLocale, t } from '@/i18n';
import { useToast } from '@/ui/state';
import { runTask } from '@/worker';
import { describeEpgStatus } from './epgStatus';
import { TextInput } from './xtream/TextInput';

/** Query parameters (or path segments) that would carry a secret in plain text. */
const CREDENTIAL_PARAM = /[?&](user(name)?|pass(word)?|pwd|token|key|auth)=/i;

export type EpgUrlCheck =
  { ok: true; url: string | undefined } | { ok: false; reason: 'invalid' | 'credentials' };

/** Validates the manual guide address; empty means "use the list's own". */
export function checkEpgUrl(input: string): EpgUrlCheck {
  if (input.trim() === '') return { ok: true, url: undefined };
  const parsed = parseExternalUrl(input, 'epg');
  if (!parsed.ok)
    return { ok: false, reason: parsed.reason === 'credentials' ? 'credentials' : 'invalid' };
  if (CREDENTIAL_PARAM.test(parsed.url.search)) return { ok: false, reason: 'credentials' };
  return { ok: true, url: parsed.url.href };
}

export function EpgSettings({ source: initial }: { source: Source }) {
  const text = t.sources.edit.epg;
  const toast = useToast();
  const [source, setSource] = useState(initial);
  const [url, setUrl] = useState(initial.epgUrl ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'save' | 'refresh'>();
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = async () => {
    const fresh = await sourcesRepo.get(source.id);
    if (!fresh || !mounted.current) return;
    setSource(fresh);
    setNow(Date.now());
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const result = await runTask('importEpg', { sourceId: source.id, force: true });
      if (!mounted.current) return;
      toast.show({ message: result.status === 'ok' ? text.refreshed : text.refreshFailed });
    } catch (failure) {
      log.warn('Updating the guide failed', { error: failure });
      if (mounted.current) toast.show({ message: text.refreshFailed });
    } finally {
      if (mounted.current) {
        setBusy(undefined);
        await reload();
      }
    }
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const check = checkEpgUrl(url);
    if (!check.ok) {
      setError(text[check.reason]);
      return;
    }
    setError(undefined);
    setBusy('save');
    try {
      // A new address makes the guide due again (`epgStatus` cleared): the next open of Live,
      // or "Update guide", imports it.
      await sourcesRepo.update(source.id, { epgUrl: check.url, epgStatus: undefined });
      if (!mounted.current) return;
      toast.show({ message: text.saved });
      await reload();
    } catch (failure) {
      log.warn('Saving the guide address failed', { error: failure });
      if (mounted.current) setError(t.state.errors.unknown.message);
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }

  const status = describeEpgStatus(source, t, activeLocale(), now);
  const canRefresh = (source.epgUrl ?? '') !== '' || (source.epgUrls?.length ?? 0) > 0;

  return (
    <Stack component="section" spacing={2} aria-labelledby="epg-settings-title" sx={{ mt: 4 }}>
      <Typography id="epg-settings-title" variant="h2">
        {text.title}
      </Typography>
      <Stack component="form" noValidate onSubmit={onSubmit} spacing={2}>
        <TextInput
          id="source-epg-url"
          name="epgUrl"
          label={text.url}
          value={url}
          onChange={setUrl}
          error={error !== undefined}
          helperText={error ?? text.urlHelp}
          disabled={busy !== undefined}
          type="url"
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="outlined"
          disabled={busy !== undefined}
          sx={{ minHeight: 44 }}
        >
          {text.save}
        </Button>
      </Stack>
      <Typography role="status" color="text.secondary" data-testid="epg-status">
        {canRefresh ? status : text.noUrl}
      </Typography>
      {canRefresh && (
        <Typography variant="body2" color="text.secondary">
          {text.matchingNote}
        </Typography>
      )}
      <Button
        variant="contained"
        onClick={() => void refresh()}
        disabled={busy !== undefined || !canRefresh}
        sx={{ minHeight: 44 }}
      >
        {busy === 'refresh' ? text.refreshing : text.refresh}
      </Button>
    </Stack>
  );
}
