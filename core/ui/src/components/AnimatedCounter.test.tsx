import React from 'react';
import { render, act } from '@testing-library/react';
import { AnimatedCounter } from './AnimatedCounter';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('AnimatedCounter', () => {
  let originalRAF: any;
  let originalCAF: any;
  let originalNow: any;

  let currentTime = 0;
  let rafCallbacks: FrameRequestCallback[] = [];
  let cancelCalledCount = 0;

  beforeEach(() => {
    originalRAF = window.requestAnimationFrame;
    originalCAF = window.cancelAnimationFrame;
    originalNow = performance.now;

    currentTime = 0;
    rafCallbacks = [];
    cancelCalledCount = 0;

    // Mock performance.now safely
    // @ts-ignore
    performance.now = () => currentTime;

    // Mock requestAnimationFrame
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return 1;
    };

    // Mock cancelAnimationFrame
    window.cancelAnimationFrame = () => {
        cancelCalledCount++;
    };
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
    // @ts-ignore
    performance.now = originalNow;
  });

  const advanceTime = async (ms: number) => {
    currentTime += ms;
    const currentBatch = [...rafCallbacks];
    rafCallbacks = [];

    await act(async () => {
        currentBatch.forEach(cb => cb(currentTime));
    });
  };

  it('renders initial value correctly', () => {
    const { getByText } = render(<AnimatedCounter value={0} />);
    expect(getByText('0')).toBeInTheDocument();
  });

  it('animates to target value', async () => {
    const { getByText } = render(<AnimatedCounter value={100} duration={1000} />);

    expect(getByText('0')).toBeInTheDocument();

    await advanceTime(500);
    const el = getByText((content, element) => {
        const num = Number(content);
        return !isNaN(num) && num > 0 && num < 100;
    });
    expect(el).toBeInTheDocument();

    await advanceTime(500);
    expect(getByText('100')).toBeInTheDocument();
  });

  it('updates when value changes', async () => {
      const { rerender, getByText } = render(<AnimatedCounter value={50} duration={500} />);

      await advanceTime(500);
      expect(getByText('50')).toBeInTheDocument();

      rerender(<AnimatedCounter value={100} duration={500} />);

      await advanceTime(250);
      const displayed = getByText((content) => {
          const num = Number(content);
          return !isNaN(num) && num > 50 && num < 100;
      });
      expect(displayed).toBeInTheDocument();

      await advanceTime(250);
      expect(getByText('100')).toBeInTheDocument();
    });

  it('cancels previous animation when value changes', async () => {
      const { rerender } = render(<AnimatedCounter value={50} duration={500} />);
      await advanceTime(100); // Start animation

      rerender(<AnimatedCounter value={100} duration={500} />);

      // Should have called cancelAnimationFrame
      expect(cancelCalledCount).toBeGreaterThan(0);
  });
});
