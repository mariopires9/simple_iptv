// Localized text of the diagnostics checks (SRC-09, ADR-015), shared by the screen and the copied
// report so both always say the same thing.
import type { LiveFormat } from '@/core/db';
import { t, type Messages } from '@/i18n';
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
/** `player.probe` strings (PLY-06): the explanation of a live stream finding. */
export type ProbeText = Messages['player']['probe'];

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
    case 'liveStream': {
      const ls = text.checks.liveStream;
      const lf = text.checks.liveFormat;
      return check.probes.map(({ format, engine, result, finding }) => {
        const extra = [
          result.status !== undefined ? ls.status(String(result.status)) : undefined,
          result.redirected === true ? ls.redirected : undefined,
          result.hevc === true ? ls.hevc : undefined,
        ].filter((part): part is string => part !== undefined);
        const outcome =
          extra.length > 0 ? `${ls.results[finding]} (${extra.join(', ')})` : ls.results[finding];
        return ls.fact(
          lf.formats[format],
          engineName(text, engine) ?? ls.notPlayable,
          outcome,
          result.target ?? '?',
        );
      });
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

function explanation(check: CheckResult, text: DiagnosticsText, probeText: ProbeText): string {
  switch (check.id) {
    case 'https':
      return text.checks.https.reasons[check.reason];
    case 'api':
      return text.checks.api.reasons[check.reason];
    case 'liveFormat':
      return text.checks.liveFormat.reasons[check.reason];
    case 'liveStream': {
      const reasons = text.checks.liveStream.reasons;
      const base = Object.hasOwn(reasons, check.reason)
        ? reasons[check.reason as keyof typeof reasons]
        : probeText.causes[check.reason as keyof ProbeText['causes']];
      return check.hevc ? `${base} ${probeText.hevc}` : base;
    }
    case 'browser':
      return text.checks.browser.reasons[check.reason];
    case 'codecs':
      return text.checks.codecs.reasons[check.reason];
  }
}

export function describeCheck(
  check: CheckResult,
  text: DiagnosticsText,
  probeText: ProbeText = t.player.probe,
): DescribedCheck {
  const described: DescribedCheck = {
    id: check.id,
    status: check.status,
    title: text.checks[check.id].title,
    statusLabel: text.status[check.status],
    explanation: explanation(check, text, probeText),
    facts: facts(check, text),
    actions: check.actions.map((code) => ({ code, text: text.actions[code] })),
  };
  if ((check.id === 'liveFormat' || check.id === 'liveStream') && check.suggested !== undefined) {
    described.suggestedFormat = check.suggested;
  }
  return described;
}
