// EPG-01 request budget (found by QA-02): each channel's short EPG is asked at most once per
// CACHE_TTL_MS (src/features/live/epg.ts), even when every programme it returned has ended.
import { addXtreamSource } from './support/app';
import { expect, test } from './support/test';

test('EPG-01: a channel whose programmes have all ended is not re-requested in a loop', async ({
  page,
  sandbox,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'request-count check; one engine is enough');
  // The fixture's programmes (2026-01-01) are in the past: before the fix the entry was never
  // "fresh" and was asked again and again (81 requests in 5 s); now it is kept for its TTL.

  await addXtreamSource(page); // ends on Live TV with the channel rows visible
  const start = sandbox.panel.length;
  await page.waitForTimeout(5_000);
  const epgCalls = sandbox.panel.slice(start).filter((call) => call.startsWith('get_short_epg'));
  const perChannel = new Map<string, number>();
  for (const call of epgCalls) perChannel.set(call, (perChannel.get(call) ?? 0) + 1);
  test.info().annotations.push({
    type: 'short EPG requests in 5 s',
    description: JSON.stringify(Object.fromEntries(perChannel)),
  });
  for (const [call, count] of perChannel) {
    expect(count, `${call} requests while idle for 5 s`).toBeLessThanOrEqual(1);
  }
});
