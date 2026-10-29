// PRX-01: the default controller factory hands the view's rewriter to `createPlayerController`.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UrlRewriter } from '@/core/net';
import { usePlayerController } from './usePlayerController';

const created = vi.hoisted(() => [] as unknown[][]);
vi.mock('../controller', () => ({
  createPlayerController: (...args: unknown[]) => {
    created.push(args);
    return { stop: () => Promise.resolve() };
  },
}));

function Probe({ rewriter }: { rewriter?: UrlRewriter }) {
  const { videoRef } = usePlayerController(undefined, rewriter);
  // eslint-disable-next-line jsx-a11y/media-has-caption -- test element
  return <video ref={videoRef} />;
}

describe('usePlayerController default factory', () => {
  it('passes the rewriter to createPlayerController (none → no option)', () => {
    const rewriter: UrlRewriter = { rewrite: (url) => url };
    const first = render(<Probe rewriter={rewriter} />);
    expect(created[0]?.[1]).toEqual({ rewriter });
    first.unmount();
    render(<Probe />);
    expect(created[1]?.[1]).toEqual({});
  });
});
