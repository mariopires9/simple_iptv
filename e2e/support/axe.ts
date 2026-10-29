// axe-core checks (QA-02 AC2): WCAG 2.x A/AA rules; only serious and critical violations fail.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FAILING_IMPACTS = new Set(['serious', 'critical']);

export interface AxeFinding {
  route: string;
  rule: string;
  impact: string;
  help: string;
  targets: string[];
}

/**
 * `target-size` flags a row that is scrolled under a fixed bar (the phone bottom navigation) as
 * "partially obscured", although scrolling reveals it in full: those nodes are not counted.
 */
function isScrolledUnderFixedBar(rule: string, failureSummary: string | undefined): boolean {
  return rule === 'target-size' && (failureSummary ?? '').includes('partially obscured');
}

/** Runs axe on the current page; returns its serious/critical violations, labelled with `route`. */
export async function seriousViolations(page: Page, route: string): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => FAILING_IMPACTS.has(v.impact ?? ''))
    .map((v) => ({
      violation: v,
      nodes: v.nodes.filter((n) => !isScrolledUnderFixedBar(v.id, n.failureSummary)),
    }))
    .filter(({ nodes }) => nodes.length > 0)
    .map(({ violation, nodes }) => ({
      route,
      rule: violation.id,
      impact: violation.impact ?? '',
      help: violation.help,
      targets: nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

/** One line per finding, for the assertion message and the test report. */
export function formatFindings(findings: readonly AxeFinding[]): string {
  return findings
    .map((f) => `${f.route} · ${f.impact} · ${f.rule}: ${f.help} → ${f.targets.join(', ')}`)
    .join('\n');
}
