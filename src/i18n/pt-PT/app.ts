import type { app as base } from '../en/app';
import type { MessageShape } from '../types';

export const app = {
  name: 'Simple IPTV',
} satisfies MessageShape<typeof base>;
