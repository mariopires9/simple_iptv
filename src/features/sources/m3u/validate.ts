// Client-side validation of the add-M3U-URL form (SRC-05). Pure: returns the error text or the
// normalized URL and its host (the default source name).
import { parseExternalUrl } from '@/core/net';
import { t } from '@/i18n';

export interface M3uUrlFormValues {
  url: string;
  name: string;
}

export type M3uUrlValidation =
  { ok: true; url: string; host: string } | { ok: false; error: string };

export function validateM3uUrlForm(values: M3uUrlFormValues): M3uUrlValidation {
  const text = t.sources.addM3uUrl.validation;
  if (values.url.trim() === '') return { ok: false, error: text.urlRequired };
  const parsed = parseExternalUrl(values.url, 'source');
  if (!parsed.ok) return { ok: false, error: text.url[parsed.reason] };
  return { ok: true, url: parsed.url.href, host: parsed.url.hostname };
}
