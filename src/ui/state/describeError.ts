// Error → user-facing description (UX-02 AC3, docs/UX_UI.md §1 "Honesty": say what happened and
// what to do). Every feature turns caught errors into StateView/toast content through this.
//
// The typed errors are recognised structurally (`name` + their discriminant field) instead of with
// `instanceof`: `DatabaseUnavailableError` and `VaultKeyLostError` live in modules that pull in
// Dexie (core/db, core/crypto) and `WorkerTaskError` sits behind the worker client, none of which
// may be loaded by `@/ui` (initial bundle, ADR-003). Only types are imported from them.
import type { DatabaseUnavailableReason } from '@/core/db';
import type { VaultKeyLostReason } from '@/core/crypto';
import { redact } from '@/core/log';
import type { NetErrorHint, NetErrorKind } from '@/core/net';
import type { WorkerTaskErrorKind } from '@/core/worker';
import type { Messages } from '@/i18n';

/** What the user can do about the error; the caller wires the matching handler. */
export type SuggestedAction = 'retry' | 'reload' | 'edit-source' | 'reenter-credentials' | 'none';

export interface ErrorDescription {
  /** Stable code for tests, telemetry-free diagnostics and per-feature overrides (e.g. `net.blocked.cors`). */
  code: string;
  /** StateView variant to render it with (`empty`, i.e. neutral, for a cancellation). */
  variant: 'error' | 'offline' | 'empty';
  /**
   * The user (or the app) cancelled the operation: not a failure. Callers normally ignore
   * cancellations instead of rendering them; the neutral texts exist for the rare screen that
   * must say why it stopped.
   */
  cancelled: boolean;
  title: string;
  message: string;
  action: SuggestedAction;
  /** Localized label for `action`; undefined when `action` is `'none'`. */
  actionLabel: string | undefined;
  /** Technical, redacted text for the "Details" disclosure: never a stack trace. */
  details: string;
}

const NET_KINDS: ReadonlySet<string> = new Set<NetErrorKind>([
  'offline',
  'timeout',
  'aborted',
  'blocked',
  'http',
  'auth',
  'parse',
]);
const NET_HINTS: ReadonlySet<string> = new Set<NetErrorHint>(['mixed-content', 'cors']);
const WORKER_KINDS: ReadonlySet<string> = new Set<WorkerTaskErrorKind>(['cancelled', 'failed']);
const DB_REASONS: ReadonlySet<string> = new Set<DatabaseUnavailableReason>([
  'unsupported',
  'open-failed',
  'timeout',
]);
const VAULT_REASONS: ReadonlySet<string> = new Set<VaultKeyLostReason>([
  'missing-key',
  'decrypt-failed',
]);

/** Maximum length of the details text (it is shown on screen and may be copied). */
export const MAX_DETAILS_LENGTH = 2000;
const MAX_CAUSE_DEPTH = 3;

type Fields = Record<string, unknown>;

function typed(error: unknown, name: string): Fields | undefined {
  return error instanceof Error && error.name === name ? (error as unknown as Fields) : undefined;
}

function field<T extends string>(fields: Fields, key: string, allowed: ReadonlySet<string>) {
  const value = fields[key];
  return typeof value === 'string' && allowed.has(value) ? (value as T) : undefined;
}

/** One line for a thrown value that is not an Error (never serialised: it may hold anything). */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return `Thrown ${value === null ? 'null' : typeof value}`;
}

/**
 * `Name: message` lines for the error and its `cause` chain (stops at a null/undefined cause).
 * `stack` is never read, so no stack trace can reach the text — messages are kept whole.
 */
function describeChain(error: unknown): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (depth > 0 && (current === undefined || current === null)) break;
    const prefix = depth === 0 ? '' : 'Caused by: ';
    if (current instanceof Error) {
      lines.push(`${prefix}${current.name}: ${current.message}`);
      current = (current as { cause?: unknown }).cause;
    } else {
      lines.push(`${prefix}${describeValue(current)}`);
      break;
    }
  }
  return lines;
}

export function errorDetails(error: unknown, extra: readonly string[] = []): string {
  const text = [...describeChain(error), ...extra].join('\n');
  const redacted = redact(text);
  return redacted.length > MAX_DETAILS_LENGTH
    ? `${redacted.slice(0, MAX_DETAILS_LENGTH - 1)}…`
    : redacted;
}

function result(
  t: Messages,
  code: string,
  text: { title: string; message: string },
  action: SuggestedAction,
  details: string,
  variant: ErrorDescription['variant'] = 'error',
): ErrorDescription {
  return {
    code,
    variant,
    cancelled: false,
    title: text.title,
    message: text.message,
    action,
    actionLabel: action === 'none' ? undefined : t.state.actions[action],
    details,
  };
}

/** Neutral result for a cancelled request/task: no error styling, nothing to do. */
function cancelledResult(t: Messages, code: string, error: unknown): ErrorDescription {
  return {
    ...result(t, code, t.state.errors.cancelled, 'none', errorDetails(error), 'empty'),
    cancelled: true,
  };
}

/**
 * Maps any thrown value to localized title/message, a suggested action and redacted details:
 * - `NetError` by `kind` (and `hint` for `blocked`; `status` for `http`),
 * - `WorkerTaskError` by `kind`, `DatabaseUnavailableError` and `VaultKeyLostError` by `reason`,
 * - anything else → the generic "Something went wrong".
 * A cancellation (`NetError` `aborted`, `WorkerTaskError` `cancelled`) is not a failure: the result
 * has `cancelled: true`, a neutral variant and no action. Callers normally just ignore it.
 */
export function describeError(error: unknown, t: Messages): ErrorDescription {
  const e = t.state.errors;

  const net = typed(error, 'NetError');
  const netKind = net && field<NetErrorKind>(net, 'kind', NET_KINDS);
  if (net && netKind) {
    const hint = field<NetErrorHint>(net, 'hint', NET_HINTS);
    const details = errorDetails(error);
    switch (netKind) {
      case 'offline':
        return result(t, 'net.offline', e.net.offline, 'retry', details, 'offline');
      case 'timeout':
        return result(t, 'net.timeout', e.net.timeout, 'retry', details);
      case 'aborted':
        return cancelledResult(t, 'net.aborted', error);
      case 'blocked':
        // The hint only refines `blocked`: it is how the network layer explains a blocked request.
        if (hint === 'cors')
          return result(t, 'net.blocked.cors', e.net.blockedCors, 'edit-source', details);
        if (hint === 'mixed-content')
          return result(
            t,
            'net.blocked.mixed-content',
            e.net.blockedMixedContent,
            'edit-source',
            details,
          );
        return result(t, 'net.blocked', e.net.blocked, 'retry', details);
      case 'http': {
        const status = net['status'];
        const message =
          typeof status === 'number' ? e.net.httpStatus(String(status)) : e.net.http.message;
        return result(t, 'net.http', { title: e.net.http.title, message }, 'retry', details);
      }
      case 'auth':
        return result(t, 'net.auth', e.net.auth, 'reenter-credentials', details);
      case 'parse':
        return result(t, 'net.parse', e.net.parse, 'retry', details);
    }
  }

  const worker = typed(error, 'WorkerTaskError');
  const workerKind = worker && field<WorkerTaskErrorKind>(worker, 'kind', WORKER_KINDS);
  if (workerKind === 'cancelled') return cancelledResult(t, 'worker.cancelled', error);
  if (workerKind === 'failed')
    return result(t, 'worker.failed', e.worker.failed, 'retry', errorDetails(error));

  const db = typed(error, 'DatabaseUnavailableError');
  const dbReason = db && field<DatabaseUnavailableReason>(db, 'reason', DB_REASONS);
  if (dbReason)
    return result(
      t,
      `db.${dbReason}`,
      { title: e.db.title, message: t.db.errors[dbReason] },
      'reload',
      errorDetails(error),
    );

  const vault = typed(error, 'VaultKeyLostError');
  const vaultReason = vault && field<VaultKeyLostReason>(vault, 'reason', VAULT_REASONS);
  if (vaultReason)
    return result(
      t,
      `vault.${vaultReason}`,
      e.vault[vaultReason],
      'reenter-credentials',
      errorDetails(error),
    );

  return result(t, 'unknown', e.unknown, 'retry', errorDetails(error));
}
