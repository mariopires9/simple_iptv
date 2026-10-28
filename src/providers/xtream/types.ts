// Connection report contract (docs/ARCHITECTURE.md §4). Defined here until a second provider
// (M3U) needs it; then it moves to a shared `src/providers` module.
import type { NetError, NetErrorKind } from '@/core/net';

/**
 * Stable problem codes; the UI maps them to localized text (ADR-015). Codes are never shown as is.
 */
export type ConnectionProblemCode =
  | 'auth-failed'
  | 'account-expired'
  | 'account-banned'
  | 'account-disabled'
  | 'account-inactive'
  | 'max-connections-reached'
  | 'offline'
  | 'timeout'
  | 'blocked-mixed-content'
  | 'blocked-cors'
  | 'network-error'
  | 'http-error'
  | 'invalid-response'
  | 'http-only'
  | 'https-unavailable';

/** Suggested action codes; the UI maps them to localized text and links. */
export type ConnectionFixCode =
  | 'check-credentials'
  | 'renew-subscription'
  | 'contact-provider'
  | 'close-other-players'
  | 'check-network'
  | 'retry-later'
  | 'check-server-url'
  | 'see-connection-options';

export interface ConnectionProblem {
  code: ConnectionProblemCode;
  /** `error` makes the report not ok; `warning` is informative. */
  severity: 'error' | 'warning';
  /**
   * Fixed English diagnostic text for logs/diagnostics, never shown in the UI (the UI uses
   * `code`). Contains no host, URL or credentials.
   */
  message: string;
  fix?: ConnectionFixCode;
}

export interface ConnectionAccount {
  /** As sent by the panel (`Active`, `Expired`…); `Unknown` when missing. */
  status: string;
  /** Epoch ms; undefined = no expiry or unknown. */
  expiresAt?: number;
  maxConnections?: number;
  activeConnections?: number;
  /** Allowed output formats (e.g. `m3u8`, `ts`). */
  formats: string[];
}

export interface ConnectionReport {
  ok: boolean;
  /** Whether the usable base URL is `https:`. */
  https: boolean;
  corsApi: 'ok' | 'blocked' | 'unknown';
  account?: ConnectionAccount;
  problems: ConnectionProblem[];
}

export interface XtreamConnectionReport extends ConnectionReport {
  /**
   * Base URL to use from now on (`scheme://host[:port]`, no credentials): the HTTPS one when the
   * automatic HTTPS attempt worked, otherwise the one the user entered (normalized).
   * Use `displayUrl` before showing it.
   */
  baseUrl: string;
  /** Result of the automatic HTTPS attempt (only when the server is http and reports `https_port`). */
  httpsCheck?: { baseUrl: string; ok: boolean; error?: NetErrorKind };
  /** The error that prevented authentication, when there is one (message is already redacted). */
  error?: NetError;
}
