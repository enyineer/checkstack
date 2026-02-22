import { render, act } from "@testing-library/react";
import { AnimatedNumber } from "./AnimatedNumber";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Mock requestAnimationFrame to control time
const originalRAF = global.requestAnimationFrame;
const originalCAF = global.cancelAnimationFrame;

describe("AnimatedNumber", () => {
  let currentTime = 0;
  let callbacks: Map<number, FrameRequestCallback> = new Map();
  let nextId = 1;

  beforeEach(() => {
    currentTime = 0;
    callbacks.clear();
    nextId = 1;

    global.requestAnimationFrame = (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    };

    global.cancelAnimationFrame = (id) => {
      callbacks.delete(id);
    };
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCAF;
  });

  const advanceTime = (ms: number) => {
    currentTime += ms;
    // Execute callbacks
    const currentCallbacks = Array.from(callbacks.entries());
    callbacks.clear(); // Clear before executing to allow re-scheduling

    // In React 18, state updates are batched. We wrap in act.
    act(() => {
        currentCallbacks.forEach(([_id, callback]) => {
            callback(currentTime);
        });
    });
  };

  it("renders initial value immediately", () => {
    const { getByText } = render(<AnimatedNumber value={100} />);
    expect(getByText("100.00")).toBeTruthy();
  });

  it("renders N/A for undefined value", () => {
    const { getByText } = render(<AnimatedNumber value={undefined} />);
    expect(getByText("N/A")).toBeTruthy();
  });

  it("renders suffix", () => {
    const { getByText } = render(<AnimatedNumber value={100} suffix="%" />);
    expect(getByText("%")).toBeTruthy();
  });

  it("animates value change", async () => {
    const { getByText, rerender } = render(<AnimatedNumber value={0} duration={1000} />);
    expect(getByText("0.00")).toBeTruthy();

    rerender(<AnimatedNumber value={100} duration={1000} />);

    // Advance time to 500ms (halfway)
    advanceTime(500);
    // Should be somewhere between 0 and 100
    // We don't check exact value due to easing, but it shouldn't be 0 or 100 yet
    // Actually, with the current implementation using state, the DOM should update.

    // Advance time to 1000ms (complete)
    // Note: The first frame sets the start time, so we need to advance duration + initial delay
    advanceTime(2000);

    expect(getByText("100.00")).toBeTruthy();
  });
});
