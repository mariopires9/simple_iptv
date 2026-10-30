// Channel ↔ XMLTV matching — EPG-03 AC1–AC3. Pure; used by the EPG import in the data worker.
//
// Order, per app channel:
//   1. `tvg-id` equal to an XMLTV channel id (exact). A programme whose `channel` attribute equals
//      the `tvg-id` is matched even when the feed declares no `<channel>` element for it.
//   2. `tvg-id` equal to exactly one declared XMLTV id ignoring case.
//   3. Its normalized name equal to the normalized display name (or id) of exactly one declared
//      XMLTV channel. A name that fits several XMLTV channels is ambiguous and not associated, so
//      the channel counts as "no EPG" (a wrong guide is worse than none).
// Name fallback only uses `<channel>` elements seen before the first programme (XMLTV lists them
// first; a feed that interleaves them only gets exact `tvg-id` matches for the late ones).

export interface EpgChannelRef {
  /** App channel item key. */
  key: string;
  name: string;
  /** `tvg-id`. */
  epgId?: string;
}

const QUALITY = /\b(?:uhd|fhd|hd|sd|4k|8k|hevc|h\.?26[45]|1080[pi]?|720p|2160p)\b/g;
const COUNTRY_PREFIX = /^\s*[[(]?[a-z]{2,3}[\])]?\s*(?:[:|]|-\s)\s*/;
const BRACKET_COUNTRY_PREFIX = /^\s*[[(][a-z]{2,3}[\])]\s*/;
const PLUS_ONE = /(?:^|\s)\+1(?=\s|$)/g;

/**
 * Channel name for matching: no accents, lowercase, without quality tags (HD, FHD, 4K…), the
 * "+1" tag, a country prefix ("PT:", "PT |", "[PT]") and anything that is not a letter or digit.
 */
export function normalizeChannelName(name: string): string {
  let s = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(COUNTRY_PREFIX, '').replace(BRACKET_COUNTRY_PREFIX, '');
  s = s.replace(QUALITY, ' ').replace(PLUS_ONE, ' ');
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** XMLTV ids often end in a country code (`RTP1.pt`): the rest is also tried as a name. */
function idAsName(id: string): string {
  return normalizeChannelName(id.replace(/\.[a-z]{2,3}$/i, ''));
}

export interface MatchStats {
  /** App channels associated with an XMLTV id (whether or not it has programmes). */
  associated: number;
  /** App channels left without one because their name fits several XMLTV channels. */
  ambiguous: number;
  total: number;
}

export class ChannelMatcher {
  private readonly declared = new Map<string, string[]>();
  private resolved: Map<string, string[]> | undefined;
  /** App channel key → XMLTV id it is associated with. */
  private assignment: Map<string, string> | undefined;
  private ambiguous = 0;

  constructor(private readonly channels: readonly EpgChannelRef[]) {}

  /** Registers a declared `<channel>` (before the first `resolve`). */
  addXmltvChannel(id: string, names: readonly string[]): void {
    if (this.resolved || this.declared.has(id)) return;
    this.declared.set(id, [...names]);
  }

  /** App channel keys that should receive the programmes of XMLTV channel `xmltvId`. */
  resolve(xmltvId: string): readonly string[] {
    return this.finalize().get(xmltvId) ?? [];
  }

  /** XMLTV id associated with each app channel key. */
  assignments(): ReadonlyMap<string, string> {
    this.finalize();
    return this.assignment as Map<string, string>;
  }

  stats(): MatchStats {
    return {
      associated: this.assignments().size,
      ambiguous: this.ambiguous,
      total: this.channels.length,
    };
  }

  private finalize(): Map<string, string[]> {
    if (this.resolved) return this.resolved;
    const byLowerId = new Map<string, Set<string>>();
    const byName = new Map<string, Set<string>>();
    const add = (map: Map<string, Set<string>>, key: string, id: string) => {
      if (key === '') return;
      let set = map.get(key);
      if (!set) map.set(key, (set = new Set()));
      set.add(id);
    };
    for (const [id, names] of this.declared) {
      add(byLowerId, id.toLowerCase(), id);
      add(byName, idAsName(id), id);
      for (const name of names) add(byName, normalizeChannelName(name), id);
    }
    const unique = (set: Set<string> | undefined): string | undefined =>
      set?.size === 1 ? (set.values().next().value as string) : undefined;

    const assignment = new Map<string, string>();
    const resolved = new Map<string, string[]>();
    for (const channel of this.channels) {
      const epgId = channel.epgId?.trim();
      let id: string | undefined;
      let ambiguous = false;
      if (epgId) {
        // Exact tvg-id: kept even if undeclared (programmes may reference it directly).
        if (this.declared.has(epgId) || this.declared.size === 0) id = epgId;
        else id = unique(byLowerId.get(epgId.toLowerCase()));
      }
      if (id === undefined) {
        const candidates = byName.get(normalizeChannelName(channel.name));
        id = unique(candidates);
        ambiguous = candidates !== undefined && candidates.size > 1;
      }
      if (id === undefined && epgId) id = epgId; // an undeclared exact id still may get programmes
      if (id === undefined) {
        if (ambiguous) this.ambiguous++;
        continue;
      }
      assignment.set(channel.key, id);
      const keys = resolved.get(id);
      if (keys) keys.push(channel.key);
      else resolved.set(id, [channel.key]);
    }
    this.assignment = assignment;
    this.resolved = resolved;
    return resolved;
  }
}
