// Programme source of the guide grid (EPG-04), behind the same `EpgService` interface as now/next:
// - Xtream: the short EPG (EPG-01 service: queue, concurrency cap, 429 backoff, cache), asking
//   for GUIDE_XTREAM_LIMIT programmes per channel instead of two. Panels answer from "now", so
//   the past part of the span stays empty for these lists.
// - M3U + XMLTV: the stored guide (EPG-02), one range read per channel over the whole span.
// Requests are made only for the visible rows (`useVisibleEpg`).
import { epgRepo, type Source } from '@/core/db';
import { createEpgService, type EpgDeps, type EpgService } from './epg';
import type { GuideWindow } from './guideLayout';
import { createXmltvEpgService } from './xmltvEpg';

/** Short-EPG programmes asked per Xtream channel: about a day of a typical schedule. */
export const GUIDE_XTREAM_LIMIT = 24;

export function createGuideEpgService(
  source: Source,
  span: GuideWindow,
  /** Xtream request dependencies (tests). */
  deps: Pick<EpgDeps, 'vault' | 'fetchImpl'> = {},
): EpgService | undefined {
  return (
    createEpgService(source, { ...deps, limit: GUIDE_XTREAM_LIMIT }) ??
    createXmltvEpgService(source, {
      fixedTtl: true,
      upcoming: (channelKey) => epgRepo.between(channelKey, span.start, span.end),
    })
  );
}
