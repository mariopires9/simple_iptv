// Tolerant Valibot schemas for Xtream Codes responses (ADR-013, RESEARCH.md §7).
// Panels differ: numbers may arrive as strings, fields may be null or missing, unknown fields are
// ignored (valibot `object` strips them). A field with an unusable value becomes `undefined`
// instead of failing the whole response.
import * as v from 'valibot';

/** `12`, `"12"`, `" 12 "` → 12; `""`, `null`, `"abc"`, `NaN` → undefined. */
export function toInt(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
  return undefined;
}

/** Non-empty trimmed string; numbers are stringified; anything else → undefined. */
export function toText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'null' ? undefined : trimmed;
}

/** `1`, `"1"`, `true`, `"true"` → true; `0`, `"0"`, `false`, `"false"` → false; else undefined. */
export function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const n = toInt(value);
  if (n !== undefined) return n !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return undefined;
}

/** Below this, a timestamp is in seconds (≈ year 33658 in seconds; 2001 in ms). */
const MS_THRESHOLD = 1e12;

/**
 * Unix timestamp → ms. Xtream sends seconds; a value that is already in ms is kept. `0`, `null`,
 * `""` and negatives → undefined (panels use them for "no expiry").
 */
export function toEpochMs(value: unknown): number | undefined {
  const n = toInt(value);
  if (n === undefined || n <= 0) return undefined;
  return n >= MS_THRESHOLD ? n : n * 1000;
}

/** Array of non-empty strings (other items dropped); a single string becomes a one-item array. */
export function toStringList(value: unknown): string[] {
  const items = Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of items) {
    const text = toText(item);
    if (text !== undefined) out.push(text);
  }
  return out;
}

const coerce = <T>(fn: (value: unknown) => T) => v.optional(v.pipe(v.unknown(), v.transform(fn)));

export const UserInfoSchema = v.object({
  auth: coerce(toBool),
  status: coerce(toText),
  message: coerce(toText),
  exp_date: coerce(toEpochMs),
  created_at: coerce(toEpochMs),
  is_trial: coerce(toBool),
  active_cons: coerce(toInt),
  max_connections: coerce(toInt),
  allowed_output_formats: v.optional(v.pipe(v.unknown(), v.transform(toStringList)), () => []),
});

export const ServerInfoSchema = v.object({
  url: coerce(toText),
  port: coerce(toInt),
  https_port: coerce(toInt),
  server_protocol: coerce(toText),
  timezone: coerce(toText),
  timestamp_now: coerce(toEpochMs),
});

/** `player_api.php` without `action`. `user_info` must be an object; `server_info` is optional. */
export const AuthResponseSchema = v.object({
  user_info: UserInfoSchema,
  server_info: v.fallback(v.optional(ServerInfoSchema), undefined),
});

export type AuthResponse = v.InferOutput<typeof AuthResponseSchema>;

/** Valid TCP port or undefined. */
export function toPort(value: number | undefined): number | undefined {
  return value !== undefined && value >= 1 && value <= 65535 ? value : undefined;
}

export interface XtreamAccount {
  /**
   * `user_info.auth`: true/false when the panel sends it (1/"1"/true, 0/"0"/false), undefined when
   * missing, null or unrecognised. Only an explicit `false` means the credentials were rejected.
   */
  auth?: boolean;
  /** `user_info.status` as sent by the panel (`Active`, `Expired`, `Banned`, `Disabled`…). */
  status?: string;
  /** Expiry in epoch ms; undefined = no expiry / unknown. */
  expiresAt?: number;
  createdAt?: number;
  isTrial?: boolean;
  maxConnections?: number;
  activeConnections?: number;
  /** `allowed_output_formats` (e.g. `m3u8`, `ts`). */
  formats: string[];
}

export interface XtreamServerInfo {
  /** As reported by the panel; never used to build request URLs (it could point elsewhere). */
  url?: string;
  port?: number;
  httpsPort?: number;
  protocol?: string;
  timezone?: string;
  /** Server clock in epoch ms. */
  now?: number;
}

export interface XtreamAuthInfo {
  account: XtreamAccount;
  server?: XtreamServerInfo;
}

/** True only for an explicit rejection (`user_info.auth` 0/"0"/false). */
export function isAuthRejection(body: unknown): boolean {
  return parseAuthResponse(body)?.account.auth === false;
}

/** Returns undefined when the body is not an auth response (e.g. no `user_info` object). */
export function parseAuthResponse(body: unknown): XtreamAuthInfo | undefined {
  const result = v.safeParse(AuthResponseSchema, body);
  if (!result.success) return undefined;
  const { user_info: u, server_info: s } = result.output;
  const account: XtreamAccount = { formats: u.allowed_output_formats };
  if (u.auth !== undefined) account.auth = u.auth;
  if (u.status !== undefined) account.status = u.status;
  if (u.exp_date !== undefined) account.expiresAt = u.exp_date;
  if (u.created_at !== undefined) account.createdAt = u.created_at;
  if (u.is_trial !== undefined) account.isTrial = u.is_trial;
  if (u.max_connections !== undefined && u.max_connections >= 0) {
    account.maxConnections = u.max_connections;
  }
  if (u.active_cons !== undefined && u.active_cons >= 0) {
    account.activeConnections = u.active_cons;
  }
  if (s === undefined) return { account };
  const server: XtreamServerInfo = {};
  if (s.url !== undefined) server.url = s.url;
  const port = toPort(s.port);
  if (port !== undefined) server.port = port;
  const httpsPort = toPort(s.https_port);
  if (httpsPort !== undefined) server.httpsPort = httpsPort;
  if (s.server_protocol !== undefined) server.protocol = s.server_protocol.toLowerCase();
  if (s.timezone !== undefined) server.timezone = s.timezone;
  if (s.timestamp_now !== undefined) server.now = s.timestamp_now;
  return { account, server };
}
