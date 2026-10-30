// Technical "Details" text of the player error overlay (PLY-06): the final error, then every
// format the player tried, in order, with the engine, the error and — once the root-cause probe
// ran — what the check of that address found. Built only from masked values (`PlaybackError`
// keeps the shortened, redacted URL) and redacted again as defence in depth.
import { redact } from '@/core/log';
import { t } from '@/i18n';
import type { PlaybackAttempt, PlaybackError } from '../types';
import { containerName } from './codecNames';

/** What the probe found for one attempt (see `@/player/probe`), as the details need it. */
export interface AttemptCheck {
  index: number;
  finding: string;
  status?: number | undefined;
  redirected?: boolean | undefined;
  hevc?: boolean | undefined;
}

function engineLabel(attempt: PlaybackAttempt): string {
  const a = t.player.attempts;
  if (attempt.engine === 'unsupported') return a.skipped;
  const name = a.engines[attempt.engine];
  return attempt.mediaSource !== undefined
    ? a.withMediaSource(name, a.mediaSources[attempt.mediaSource])
    : name;
}

function checkLine(check: AttemptCheck): string {
  const a = t.player.attempts;
  const facts = [
    check.status !== undefined ? a.status(check.status) : undefined,
    check.redirected === true ? a.redirected : undefined,
    check.hevc === true ? a.hevc : undefined,
  ].filter((fact): fact is string => fact !== undefined);
  return a.probe(check.finding, facts.join(', '));
}

export function failureDetails(error: PlaybackError, checks: readonly AttemptCheck[] = []): string {
  const attempts = error.attempts ?? [];
  if (attempts.length === 0) return redact(error.message);
  const lines = [error.message, '', t.player.attempts.heading];
  attempts.forEach((attempt, index) => {
    const format = containerName(attempt.container) ?? attempt.container;
    lines.push(
      t.player.attempts.line(index + 1, format, engineLabel(attempt), attempt.error.message),
    );
    const check = checks.find((c) => c.index === index);
    if (check) lines.push(checkLine(check));
  });
  return redact(lines.join('\n'));
}
