// Saved audio/subtitle language preference (PLY-05 AC4): the language of the last track the user
// chose in the player, applied automatically to later streams that have a track in it.
import { useEffect, useState } from 'react';
import * as v from 'valibot';
import type { MediaTrack } from '../types';

export interface TrackPreference {
  /** Preferred audio language. */
  audio?: string;
  /** Preferred subtitle language; `null` = subtitles off. */
  subtitles?: string | null;
}

const LANGUAGE = v.pipe(v.string(), v.maxLength(35), v.regex(/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i));

/** Tolerant: a stored value that is not an object, or an invalid field, is ignored. */
export function parseTrackPreference(stored: unknown): TrackPreference {
  if (typeof stored !== 'object' || stored === null) return {};
  const { audio, subtitles } = stored as Record<string, unknown>;
  const pref: TrackPreference = {};
  const a = v.safeParse(LANGUAGE, audio);
  if (a.success) pref.audio = a.output;
  if (subtitles === null) pref.subtitles = null;
  else {
    const s = v.safeParse(LANGUAGE, subtitles);
    if (s.success) pref.subtitles = s.output;
  }
  return pref;
}

const primary = (tag: string) => tag.toLowerCase().split('-')[0];

/** The track in `language`: an exact tag match first, else the same primary language. */
export function pickTrack(tracks: readonly MediaTrack[], language: string): MediaTrack | undefined {
  const wanted = language.toLowerCase();
  return (
    tracks.find((track) => track.language?.toLowerCase() === wanted) ??
    tracks.find(
      (track) => track.language !== undefined && primary(track.language) === primary(wanted),
    )
  );
}

/** Last value read or saved: a player mounted again starts with it. */
let cached: TrackPreference | undefined;

/** The stored preference; `undefined` until read. An unavailable database reads as none. */
export function useTrackPreference(): TrackPreference | undefined {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    let active = true;
    // Dexie is loaded on demand: the player chunk does not pull it in statically.
    import('@/core/db')
      .then(({ settingsRepo }) => settingsRepo.get('trackLanguages'))
      .then(parseTrackPreference, () => ({}))
      .then((pref) => {
        // A choice saved while reading wins over the stored value.
        cached = { ...pref, ...cached };
        if (active) setValue(cached);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return value;
}

/** Saves a choice made in the player; best effort (the choice itself is already applied). */
export function saveTrackPreference(update: TrackPreference): void {
  cached = { ...cached, ...update };
  const next = cached;
  import('@/core/db')
    .then(({ settingsRepo }) => settingsRepo.set('trackLanguages', next))
    .catch(() => undefined);
}

/** Tests only: forget the cached preference. */
export function resetTrackPreferenceForTests(): void {
  cached = undefined;
}
