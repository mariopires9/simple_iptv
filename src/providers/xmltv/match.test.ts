// EPG-03 AC1–AC3: channel ↔ XMLTV matching, table of ≥ 50 pairs. Synthetic names and ids.
import { describe, expect, it } from 'vitest';
import { ChannelMatcher, normalizeChannelName } from './match';

/** Declared XMLTV channels: id → display names. */
const XMLTV: Record<string, string[]> = {
  'RTP1.pt': ['RTP 1'],
  'RTP2.pt': ['RTP 2'],
  'SIC.pt': ['SIC'],
  'SICNoticias.pt': ['SIC Notícias'],
  'TVI.pt': ['TVI'],
  'CNNPortugal.pt': ['CNN Portugal'],
  'SportTV1.pt': ['Sport TV 1'],
  'SportTV2.pt': ['Sport TV 2'],
  'Eurosport1.pt': ['Eurosport 1'],
  'Panda.pt': ['Canal Panda'],
  'Hollywood.pt': ['Canal Hollywood'],
  'AXN.pt': ['AXN'],
  'AXNWhite.pt': ['AXN White'],
  'FOX.pt': ['FOX'],
  'DiscoveryPT.pt': ['Discovery Channel'],
  'Discovery.es': ['Discovery Channel'], // same name as the PT one → ambiguous by name
  'BBCOne.uk': ['BBC One'],
  'ARTE.fr': ['ARTE'],
  'Mezzo.fr': ['Mezzo'],
  'Odisseia.pt': ['Odisseia'],
};

type Row = [name: string, tvgId: string | undefined, expected: string | undefined];

const TABLE: Row[] = [
  // AC1: exact tvg-id.
  ['Anything', 'RTP1.pt', 'RTP1.pt'],
  ['RTP2 renamed', 'RTP2.pt', 'RTP2.pt'],
  ['SIC', 'SIC.pt', 'SIC.pt'],
  ['x', 'SICNoticias.pt', 'SICNoticias.pt'],
  ['TVI HD', 'TVI.pt', 'TVI.pt'],
  ['CNN', 'CNNPortugal.pt', 'CNNPortugal.pt'],
  ['Sport', 'SportTV1.pt', 'SportTV1.pt'],
  ['Sport', 'SportTV2.pt', 'SportTV2.pt'],
  ['Discovery', 'Discovery.es', 'Discovery.es'],
  ['Discovery', 'DiscoveryPT.pt', 'DiscoveryPT.pt'],
  // tvg-id differing only in case (unique).
  ['?', 'rtp1.pt', 'RTP1.pt'],
  ['?', 'AXNWHITE.PT', 'AXNWhite.pt'],
  // AC2: no tvg-id → normalized name.
  ['RTP 1', undefined, 'RTP1.pt'],
  ['RTP1', undefined, 'RTP1.pt'],
  ['rtp 1 hd', undefined, 'RTP1.pt'],
  ['RTP 1 FHD', undefined, 'RTP1.pt'],
  ['RTP 1 4K', undefined, 'RTP1.pt'],
  ['RTP 1 UHD', undefined, 'RTP1.pt'],
  ['PT: RTP 1', undefined, 'RTP1.pt'],
  ['PT | RTP 1 HD', undefined, 'RTP1.pt'],
  ['PT|RTP 1', undefined, 'RTP1.pt'],
  ['[PT] RTP 1', undefined, 'RTP1.pt'],
  ['(PT) RTP 2', undefined, 'RTP2.pt'],
  ['PT - RTP 2', undefined, 'RTP2.pt'],
  ['RTP 2 +1', undefined, 'RTP2.pt'],
  ['SIC Noticias', undefined, 'SICNoticias.pt'],
  ['SIC NOTÍCIAS HD', undefined, 'SICNoticias.pt'],
  ['sic-noticias', undefined, 'SICNoticias.pt'],
  ['SIC', undefined, 'SIC.pt'],
  ['SIC HD', undefined, 'SIC.pt'],
  ['TVI', undefined, 'TVI.pt'],
  ['TVI FHD', undefined, 'TVI.pt'],
  ['CNN Portugal', undefined, 'CNNPortugal.pt'],
  ['CNN PORTUGAL HD', undefined, 'CNNPortugal.pt'],
  ['Sport TV 1', undefined, 'SportTV1.pt'],
  ['SPORT TV 1 HEVC', undefined, 'SportTV1.pt'],
  ['SportTV2', undefined, 'SportTV2.pt'],
  ['Eurosport 1 HD', undefined, 'Eurosport1.pt'],
  ['Canal Panda', undefined, 'Panda.pt'],
  ['Panda', undefined, 'Panda.pt'], // id stripped of its country suffix
  ['Canal Hollywood HD', undefined, 'Hollywood.pt'],
  ['Hollywood', undefined, 'Hollywood.pt'],
  ['AXN', undefined, 'AXN.pt'],
  ['AXN HD', undefined, 'AXN.pt'],
  ['AXN White', undefined, 'AXNWhite.pt'],
  ['FOX 1080p', undefined, 'FOX.pt'],
  ['BBC One HD', undefined, 'BBCOne.uk'],
  ['UK: BBC One', undefined, 'BBCOne.uk'],
  ['ARTE', undefined, 'ARTE.fr'],
  ['Mezzo', undefined, 'Mezzo.fr'],
  ['Odisseia', undefined, 'Odisseia.pt'],
  ['ODISSEIA HD', undefined, 'Odisseia.pt'],
  // tvg-id unknown to the feed → falls back to the name.
  ['TVI', 'tvi-old-id', 'TVI.pt'],
  // AC3: ambiguous names are not associated.
  ['Discovery Channel', undefined, undefined],
  ['Discovery Channel HD', undefined, undefined],
  // No match at all.
  ['Unknown Channel', undefined, undefined],
  ['RTP 3', undefined, undefined],
  ['Sport TV', undefined, undefined],
  ['', undefined, undefined],
  ['HD', undefined, undefined],
];

describe('ChannelMatcher', () => {
  const matcher = new ChannelMatcher(
    TABLE.map(([name, epgId], i) => ({
      key: `src:live:${i}`,
      name,
      ...(epgId !== undefined ? { epgId } : {}),
    })),
  );
  for (const [id, names] of Object.entries(XMLTV)) matcher.addXmltvChannel(id, names);
  const assignments = matcher.assignments();

  it('has a table of at least 50 pairs', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(50);
  });

  it.each(TABLE.map((row, i) => [i, ...row] as const))(
    '#%i "%s" (tvg-id %s) → %s',
    (i, _name, epgId, expected) => {
      // An undeclared tvg-id with no name match is still kept (programmes may reference it).
      const want = expected ?? (epgId !== undefined && !(epgId in XMLTV) ? epgId : undefined);
      expect(assignments.get(`src:live:${i}`)).toBe(want);
    },
  );

  it('maps an XMLTV id to every matching app channel and counts ambiguous ones', () => {
    expect(matcher.resolve('RTP1.pt').length).toBeGreaterThan(5);
    expect(matcher.stats().ambiguous).toBe(2);
  });

  it('keeps an exact tvg-id when the feed declares no channels', () => {
    const bare = new ChannelMatcher([{ key: 'k', name: 'Whatever', epgId: 'id.1' }]);
    expect(bare.resolve('id.1')).toEqual(['k']);
  });
});

describe('normalizeChannelName', () => {
  it('strips accents, case, quality tags, +1 and the country prefix', () => {
    expect(normalizeChannelName('PT: SIC Notícias FHD +1')).toBe('sicnoticias');
  });
});
