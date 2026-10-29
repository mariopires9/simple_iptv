// "Copy report" text (SRC-09 AC3). Built only from the check results (codes → localized text) and
// the already masked address: no credentials, no host, no list name (it defaults to the host).
// As defence in depth, the text then goes through the log redactor and every value passed in
// `sensitive` (host, username…) is masked wherever it appears.
import { MASK, redact } from '@/core/log';
import type { Messages } from '@/i18n';
import { overallStatus } from './checks';
import { describeCheck } from './describe';
import type { DiagnosticsResult } from './runDiagnostics';

export interface ReportContext {
  /** `diagnostics` strings of the active locale. */
  text: Messages['diagnostics'];
  /** Localized list type (e.g. `Xtream`). */
  kindLabel: string;
  /** Protocol of the app page (`https:`). */
  pageProtocol: string | undefined;
  /** Values that must never appear in the report (host, username, password, list URL…). */
  sensitive?: readonly (string | undefined)[];
}

/** Hosts (with and without port) and the values themselves, longest first. */
function sensitiveTokens(values: readonly (string | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    // Very short values (e.g. a 1–2 character username) would mask unrelated words.
    if (trimmed.length >= 3) tokens.add(trimmed);
    try {
      const url = new URL(trimmed);
      if (url.host !== '') tokens.add(url.host);
      if (url.hostname !== '') tokens.add(url.hostname);
    } catch {
      // Not a URL.
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

export function maskSensitive(text: string, values: readonly (string | undefined)[]): string {
  let out = text;
  for (const token of sensitiveTokens(values)) out = out.split(token).join(MASK);
  return out;
}

export function buildReport(result: DiagnosticsResult, context: ReportContext): string {
  const { text } = context;
  const r = text.report;
  const lines: string[] = [
    r.heading,
    `${r.date}: ${new Date(result.at).toISOString()}`,
    `${r.listType}: ${context.kindLabel}`,
  ];
  if (result.maskedAddress !== undefined) lines.push(`${r.address}: ${result.maskedAddress}`);
  lines.push(`${r.page}: ${(context.pageProtocol ?? '?').replace(/:$/, '')}`);
  lines.push('', text.summary[overallStatus(result.checks)], '');

  for (const check of result.checks) {
    const d = describeCheck(check, text);
    lines.push(`[${d.statusLabel}] ${d.title}`, `  ${d.explanation}`);
    for (const fact of d.facts) lines.push(`  ${fact}`);
    if (d.actions.length > 0) {
      lines.push(`  ${r.actions}:`);
      for (const action of d.actions) lines.push(`  - ${action.text}`);
    }
    lines.push('');
  }
  lines.push(r.privacy);
  return redact(maskSensitive(lines.join('\n'), context.sensitive ?? []));
}
