// Localized text of the diagnostics checks (SRC-09, ADR-015), shared by the screen and the copied
// report so both always say the same thing.
import type { LiveFormat } from '@/core/db';
import type { Messages } from '@/i18n';
import type { EngineChoice } from '@/player';
import type { CheckResult, CheckStatus, DiagnosticAction } from './checks';

export interface DescribedCheck {
  id: CheckResult['id'];
  status: CheckStatus;
  title: string;
  statusLabel: string;
  /** Why this status. */
  explanation: string;
  /** What was observed (formats, flags, codecs). */
  facts: string[];
  actions: { code: DiagnosticAction; text: string }[];
  /** Live format check: the preference that would work for this list (`switch-live-format`). */
  suggestedFormat?: LiveFormat;
}

type DiagnosticsText = Messages['diagnostics'];

function engineName(text: DiagnosticsText, engine: EngineChoice): string | undefined {
  return engine === 'unsupported' ? undefined : text.checks.liveFormat.engines[engine];
}

function facts(check: CheckResult, text: DiagnosticsText): string[] {
  const yesNo = (value: boolean) => (value ? text.yes : text.no);
  switch (check.id) {
    case 'https':
      return check.httpsAvailable === true ? [text.checks.https.httpsAvailable] : [];
    case 'api':
      return check.httpStatus !== undefined
        ? [text.checks.api.httpStatus(String(check.httpStatus))]
        : [];
    case 'liveFormat': {
      const lf = text.checks.liveFormat;
      const out: string[] = [];
      if (check.configured !== undefined) out.push(lf.configured(lf.formats[check.configured]));
      if (check.allowed !== undefined) {
        out.push(
          lf.allowed(
            check.allowed
              .map((f) => f.trim())
              .filter(Boolean)
              .join(', '),
          ),
        );
      }
      const playable = (
        [
          [lf.formats.ts, engineName(text, check.support.ts)],
          [lf.formats.m3u8, engineName(text, check.support.hls)],
        ] as const
      )
        .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
        .map(([format, engine]) => `${format} (${engine})`);
      out.push(playable.length > 0 ? lf.playable(playable.join(', ')) : lf.playableNone);
      return out;
    }
    case 'browser':
      return [
        text.checks.browser.facts(yesNo(check.mse), yesNo(check.mms), yesNo(check.nativeHls)),
      ];
    case 'codecs': {
      const c = text.checks.codecs;
      return [
        check.codecs
          .map(({ codec, mediaSource, native }) =>
            c.fact(c.names[codec], yesNo(mediaSource || native)),
          )
          .join(' · '),
        c.note,
      ];
    }
  }
}

function explanation(check: CheckResult, text: DiagnosticsText): string {
  switch (check.id) {
    case 'https':
      return text.checks.https.reasons[check.reason];
    case 'api':
      return text.checks.api.reasons[check.reason];
    case 'liveFormat':
      return text.checks.liveFormat.reasons[check.reason];
    case 'browser':
      return text.checks.browser.reasons[check.reason];
    case 'codecs':
      return text.checks.codecs.reasons[check.reason];
  }
}

export function describeCheck(check: CheckResult, text: DiagnosticsText): DescribedCheck {
  const described: DescribedCheck = {
    id: check.id,
    status: check.status,
    title: text.checks[check.id].title,
    statusLabel: text.status[check.status],
    explanation: explanation(check, text),
    facts: facts(check, text),
    actions: check.actions.map((code) => ({ code, text: text.actions[code] })),
  };
  if (check.id === 'liveFormat' && check.suggested !== undefined) {
    described.suggestedFormat = check.suggested;
  }
  return described;
}
