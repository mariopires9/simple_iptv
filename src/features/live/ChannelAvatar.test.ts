import { describe, expect, it } from 'vitest';
import { initialsOf } from './ChannelAvatar';

describe('initialsOf', () => {
  it.each([
    ['RTP 1', 'R1'],
    ['sport tv', 'ST'],
    ['Ácção Canal Três', 'ÁC'],
    ['|PT| News', 'PN'],
    ['***', '?'],
  ])('%s → %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
