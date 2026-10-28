import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_ROW_HEIGHT,
  ChannelListSkeleton,
  DetailHeaderSkeleton,
  PosterGridSkeleton,
} from './Skeletons';

const SKELETON = '.MuiSkeleton-root';

describe.each([
  ['ChannelListSkeleton', <ChannelListSkeleton key="c" />],
  ['PosterGridSkeleton', <PosterGridSkeleton key="p" />],
  ['DetailHeaderSkeleton', <DetailHeaderSkeleton key="d" />],
] as [string, ReactElement][])('%s — accessibility', (_name, element) => {
  it('is aria-busy with a "Loading…" label and decorative (aria-hidden) shapes', () => {
    render(element);
    const container = screen.getByTestId('skeleton');
    expect(container).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    const shapes = container.querySelectorAll(SKELETON);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
    // The label itself is not hidden from assistive technology.
    expect(screen.getByText('Loading…').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('exposes nothing focusable', () => {
    render(element);
    expect(screen.getByTestId('skeleton').querySelector('button, a, [tabindex]')).toBeNull();
  });
});

describe('ChannelListSkeleton', () => {
  it('renders `count` rows of 64 px', () => {
    expect(CHANNEL_ROW_HEIGHT).toBe(64);
    render(<ChannelListSkeleton count={5} />);
    const rows = screen.getByTestId('skeleton').querySelector('[aria-hidden="true"]')?.children;
    expect(rows).toHaveLength(5);
    for (const row of rows ?? []) expect(getComputedStyle(row).height).toBe('64px');
  });

  it('accepts a custom label', () => {
    render(<ChannelListSkeleton label="Loading channels…" />);
    expect(screen.getByText('Loading channels…')).toBeInTheDocument();
  });
});

describe('PosterGridSkeleton', () => {
  it('renders `count` 2:3 posters', () => {
    render(<PosterGridSkeleton count={6} />);
    const posters = screen.getByTestId('skeleton').querySelectorAll('[data-shape="poster"]');
    expect(posters).toHaveLength(6);
    for (const poster of posters)
      expect(getComputedStyle(poster).aspectRatio).toMatch(/^2\s*\/\s*3$/);
  });
});

describe('DetailHeaderSkeleton', () => {
  it('renders a 2:3 poster and text lines', () => {
    render(<DetailHeaderSkeleton />);
    const container = screen.getByTestId('skeleton');
    expect(container.querySelectorAll('[data-shape="poster"]')).toHaveLength(1);
    expect(container.querySelectorAll('.MuiSkeleton-text').length).toBeGreaterThanOrEqual(3);
  });
});
