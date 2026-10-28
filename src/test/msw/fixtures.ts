// Synthetic fixtures (QA-01) bundled for MSW handlers. Browser-safe: JSON imports and Vite `?raw`
// text imports only, so the same module works in Vitest and in a Vite-built page used by Playwright.
import authOk from '../../../fixtures/xtream/auth-ok.json';
import authFail from '../../../fixtures/xtream/auth-fail.json';
import accountExpired from '../../../fixtures/xtream/account-expired.json';
import accountBanned from '../../../fixtures/xtream/account-banned.json';
import serverInfoHttps from '../../../fixtures/xtream/server-info-https.json';
import liveCategoriesA from '../../../fixtures/xtream/live-categories-variantA.json';
import liveCategoriesB from '../../../fixtures/xtream/live-categories-variantB.json';
import liveCategoriesC from '../../../fixtures/xtream/live-categories-variantC.json';
import liveStreamsA from '../../../fixtures/xtream/live-streams-variantA.json';
import liveStreamsB from '../../../fixtures/xtream/live-streams-variantB.json';
import liveStreamsC from '../../../fixtures/xtream/live-streams-variantC.json';
import vodCategoriesA from '../../../fixtures/xtream/vod-categories-variantA.json';
import vodCategoriesB from '../../../fixtures/xtream/vod-categories-variantB.json';
import vodCategoriesC from '../../../fixtures/xtream/vod-categories-variantC.json';
import vodStreamsA from '../../../fixtures/xtream/vod-streams-variantA.json';
import vodStreamsB from '../../../fixtures/xtream/vod-streams-variantB.json';
import vodStreamsC from '../../../fixtures/xtream/vod-streams-variantC.json';
import seriesCategoriesA from '../../../fixtures/xtream/series-categories-variantA.json';
import seriesCategoriesB from '../../../fixtures/xtream/series-categories-variantB.json';
import seriesCategoriesC from '../../../fixtures/xtream/series-categories-variantC.json';
import seriesA from '../../../fixtures/xtream/series-variantA.json';
import seriesB from '../../../fixtures/xtream/series-variantB.json';
import seriesC from '../../../fixtures/xtream/series-variantC.json';
import vodInfo from '../../../fixtures/xtream/vod-info.json';
import seriesInfoEpisodesObject from '../../../fixtures/xtream/series-info-episodes-object.json';
import seriesInfoEpisodesArray from '../../../fixtures/xtream/series-info-episodes-array.json';
import shortEpg from '../../../fixtures/xtream/short-epg.json';
import xtreamM3uPlus from '../../../fixtures/xtream/get-m3u-plus.m3u?raw';
import xmltvSmall from '../../../fixtures/xmltv/small.xml?raw';

export type XtreamVariant = 'A' | 'B' | 'C';

/** Credentials embedded in the synthetic Xtream fixtures (not real). */
export const XTREAM_TEST_CREDENTIALS = { username: 'jdoe', password: 'testpass' } as const;
/** Base URL of the synthetic Xtream panel (`.test` TLD is reserved and never resolves). */
export const XTREAM_TEST_BASE_URL = 'http://panel.example.test:8080';

export const xtreamFixtures = {
  authOk,
  authFail,
  accountExpired,
  accountBanned,
  serverInfoHttps,
  vodInfo,
  seriesInfoEpisodesObject,
  seriesInfoEpisodesArray,
  shortEpg,
  m3uPlus: xtreamM3uPlus,
  variants: {
    A: {
      liveCategories: liveCategoriesA,
      liveStreams: liveStreamsA,
      vodCategories: vodCategoriesA,
      vodStreams: vodStreamsA,
      seriesCategories: seriesCategoriesA,
      series: seriesA,
    },
    B: {
      liveCategories: liveCategoriesB,
      liveStreams: liveStreamsB,
      vodCategories: vodCategoriesB,
      vodStreams: vodStreamsB,
      seriesCategories: seriesCategoriesB,
      series: seriesB,
    },
    C: {
      liveCategories: liveCategoriesC,
      liveStreams: liveStreamsC,
      vodCategories: vodCategoriesC,
      vodStreams: vodStreamsC,
      seriesCategories: seriesCategoriesC,
      series: seriesC,
    },
  },
} as const;

export const xmltvFixtures = { small: xmltvSmall } as const;
