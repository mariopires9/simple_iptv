// Client-side validation of the add-Xtream form (SRC-03 AC1). Pure: returns per-field error texts
// in field order, so the form can focus the first one.
import type { ExternalUrlRejection } from '@/core/net';
import { t } from '@/i18n';
import { normalizeServerUrl } from '@/providers/xtream';

export interface XtreamFormValues {
  name: string;
  server: string;
  username: string;
  password: string;
}

export type XtreamField = keyof XtreamFormValues;

/** Fields in on-screen order (the first error gets the focus). */
export const XTREAM_FIELDS: readonly XtreamField[] = ['name', 'server', 'username', 'password'];

export type XtreamFormErrors = Partial<Record<XtreamField, string>>;

export type XtreamValidation =
  | { ok: true; baseUrl: string; host: string }
  | { ok: false; errors: XtreamFormErrors; firstInvalid: XtreamField };

function serverUrlMessage(reason: ExternalUrlRejection): string {
  return t.sources.validation.serverUrl[reason];
}

export interface XtreamValidationOptions {
  /** Editing a saved list (SRC-08): an empty password keeps the stored one. */
  passwordOptional?: boolean;
}

export function validateXtreamForm(
  values: XtreamFormValues,
  options: XtreamValidationOptions = {},
): XtreamValidation {
  const errors: XtreamFormErrors = {};
  let baseUrl = '';
  let host = '';
  if (values.server.trim() === '') errors.server = t.sources.validation.serverRequired;
  else {
    const result = normalizeServerUrl(values.server);
    if (result.ok) {
      baseUrl = result.baseUrl;
      host = result.url.hostname;
    } else errors.server = serverUrlMessage(result.reason);
  }
  if (values.username.trim() === '') errors.username = t.sources.validation.usernameRequired;
  // Passwords are used exactly as typed (spaces may be significant); only empty is rejected.
  if (values.password === '' && !options.passwordOptional)
    errors.password = t.sources.validation.passwordRequired;

  const firstInvalid = XTREAM_FIELDS.find((field) => errors[field] !== undefined);
  if (firstInvalid !== undefined) return { ok: false, errors, firstInvalid };
  return { ok: true, baseUrl, host };
}
