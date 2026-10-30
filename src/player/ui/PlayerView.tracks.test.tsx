// PLY-05 at the PlayerView level: the audio/subtitle track menu and the saved language
// preference, against the fake controller.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { settingsRepo, wipeAll } from '@/core/db';
import type { MediaTracks } from '../types';
import { LIVE, flush, renderPlayer } from './test-utils/renderPlayer';
import { parseTrackPreference, pickTrack, resetTrackPreferenceForTests } from './trackPreference';

const TRACKS: MediaTracks = {
  audio: [
    { id: '0', label: 'English', language: 'en' },
    { id: '1', label: 'Português', language: 'pt' },
  ],
  audioId: '0',
  text: [{ id: '0', label: '', language: 'en' }],
};

afterEach(async () => {
  cleanup();
  resetTrackPreferenceForTests();
  await wipeAll();
});

/** Lets the preference read (IndexedDB) settle. */
const settle = async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await flush();
};

const menuButton = () => screen.queryByRole('button', { name: 'Audio and subtitles' });

describe('PlayerView — track menu (PLY-05)', () => {
  it('AC3: no menu without alternative tracks', async () => {
    const { controller } = renderPlayer();
    await flush();
    act(() => controller.emit('tracks', { audio: [TRACKS.audio[0]!], text: [] }));
    expect(menuButton()).toBeNull();
  });

  it('AC1/AC2: lists the tracks by name or language and switches through the controller', async () => {
    const { controller } = renderPlayer();
    await settle();
    act(() => controller.emit('tracks', TRACKS));
    fireEvent.click(menuButton()!);
    expect(screen.getByRole('menuitemradio', { name: 'English', checked: true })).toBeTruthy();
    // A subtitle track without a name is shown by its language.
    expect(screen.getAllByRole('menuitemradio', { name: 'English' })).toHaveLength(2);
    expect(screen.getByRole('menuitemradio', { name: 'Off', checked: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Português' }));
    expect(controller.selectAudioTrack).toHaveBeenCalledWith('1');
    expect(controller.play).toHaveBeenCalledTimes(1); // no reload
    await settle();
    expect(await settingsRepo.get('trackLanguages')).toEqual({ audio: 'pt' });
  });

  it('AC4: applies the saved languages when the stream has them', async () => {
    await settingsRepo.set('trackLanguages', { audio: 'pt-PT', subtitles: 'en' });
    const { controller } = renderPlayer({ descriptor: LIVE });
    await settle();
    act(() => controller.emit('tracks', TRACKS));
    expect(controller.selectAudioTrack).toHaveBeenCalledWith('1');
    expect(controller.selectTextTrack).toHaveBeenCalledWith('0');
    // Applied once per load: a later update (the switch itself) does not re-apply it.
    act(() => controller.emit('tracks', { ...TRACKS, audioId: '0' }));
    expect(controller.selectAudioTrack).toHaveBeenCalledTimes(1);
  });

  it('AC4: the stored value is untrusted and matched by primary language', () => {
    expect(parseTrackPreference({ audio: 42, subtitles: '<x>' })).toEqual({});
    expect(parseTrackPreference({ audio: 'pt', subtitles: null })).toEqual({
      audio: 'pt',
      subtitles: null,
    });
    expect(parseTrackPreference('pt')).toEqual({});
    expect(pickTrack(TRACKS.audio, 'PT-br')?.id).toBe('1');
    expect(pickTrack(TRACKS.audio, 'fr')).toBeUndefined();
  });
});
