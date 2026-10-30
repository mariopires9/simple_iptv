// XMLTV guide provider (EPG-02/EPG-03): streaming parser, channel matching and the import task
// logic. Runs inside the data worker.
export {
  EPG_REFRESH_MS,
  EPG_WINDOW_FUTURE_MS,
  EPG_WINDOW_PAST_MS,
  epgUrlsOf,
  importEpg,
  isEpgDue,
  type ImportEpgDeps,
  type ImportEpgInput,
  type ImportEpgResult,
} from './import';
export { ChannelMatcher, normalizeChannelName, type EpgChannelRef } from './match';
export { XmltvParser, decodeXmlEntities, parseXmltvTime } from './parser';
