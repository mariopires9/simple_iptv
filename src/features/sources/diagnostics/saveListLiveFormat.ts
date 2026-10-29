// Changes one list's preferred live format from its diagnostics (SRC-09): the diagnosed list,
// not the active one. Same field as Settings › Playback (`prefs.liveFormat`, read by
// `resolveStream`).
import { sourcesRepo, type LiveFormat, type Source } from '@/core/db';
import { reloadSourcesIfLoaded } from '../sourcesList';

/** Returns the updated list, or `undefined` when it no longer exists. */
export async function saveListLiveFormat(
  sourceId: string,
  liveFormat: LiveFormat,
): Promise<Source | undefined> {
  const source = await sourcesRepo.get(sourceId);
  if (!source) return undefined;
  const updated: Source = { ...source, prefs: { ...source.prefs, liveFormat } };
  await sourcesRepo.update(sourceId, { prefs: updated.prefs });
  reloadSourcesIfLoaded();
  return updated;
}
