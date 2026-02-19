import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { AnimatedNumber } from "./AnimatedNumber";

// Manual mock for RAF
let now = 0;
let nextHandle = 1;
const pendingCallbacks = new Map<number, FrameRequestCallback>();

function requestAnimationFrameMock(callback: FrameRequestCallback): number {
  const handle = nextHandle++;
  pendingCallbacks.set(handle, callback);
  return handle;
}

function cancelAnimationFrameMock(handle: number) {
  pendingCallbacks.delete(handle);
}

function advanceTime(ms: number) {
  now += ms;
  // Get all callbacks currently pending
  const callbacksToRun = Array.from(pendingCallbacks.values());
  // Clear pending because rAF is one-shot
  pendingCallbacks.clear();

  callbacksToRun.forEach((cb) => cb(now));
}

describe("AnimatedNumber", () => {
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;

  beforeEach(() => {
    now = 0;
    nextHandle = 1;
    pendingCallbacks.clear();
    global.requestAnimationFrame = requestAnimationFrameMock as any;
    global.cancelAnimationFrame = cancelAnimationFrameMock as any;
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCAF;
  });

  it("renders with initial value", () => {
    render(<AnimatedNumber value={100} decimals={2} />);
    expect(screen.getByText("100.00")).toBeDefined();
  });

  it("renders N/A when value is undefined", () => {
    render(<AnimatedNumber value={undefined} />);
    expect(screen.getByText("N/A")).toBeDefined();
  });

  it("animates value change", async () => {
    const { rerender } = render(<AnimatedNumber value={0} duration={1000} />);

    expect(screen.getByText("0.00")).toBeDefined();

    // Update value to 100
    rerender(<AnimatedNumber value={100} duration={1000} />);

    // Advance time by 500ms (halfway)
    await act(async () => {
      let timePassed = 0;
      while (timePassed < 500) {
        advanceTime(16);
        timePassed += 16;
      }
    });

    // At 500ms, value should NOT be 0 and NOT be 100
    const element = screen.getByText((content) => {
      const val = parseFloat(content);
      if (isNaN(val)) return false;
      return val > 0 && val < 100;
    });

    expect(element).toBeDefined();

    // Finish animation
    await act(async () => {
      let timePassed = 0;
      while (timePassed < 600) {
        advanceTime(16);
        timePassed += 16;
      }
    });

    expect(screen.getByText("100.00")).toBeDefined();
  });

  it("handles interrupted animation gracefully", async () => {
    const { rerender } = render(<AnimatedNumber value={0} duration={1000} />);

    // Animate 0 -> 100
    rerender(<AnimatedNumber value={100} duration={1000} />);

    // Advance halfway (500ms). Eased value should be around 87.5
    await act(async () => {
       for(let i=0; i<32; i++) advanceTime(16);
    });

    // Check value is advanced
    const element = screen.getByText((content) => {
      const val = parseFloat(content);
      return val > 50 && val < 90;
    });
    expect(element).toBeDefined();

    // Interrupt! Set value to 200.
    // Should animate from CURRENT value (~87.5) to 200.
    rerender(<AnimatedNumber value={200} duration={1000} />);

    // Advance slightly (1 frame)
    await act(async () => advanceTime(16));

    // Value should still be around 87.5 + small step.
    const elementInterrupted = screen.getByText((content) => {
      const val = parseFloat(content);
      // It should continue from ~87 upwards
      return val > 87 && val < 100;
    });
    expect(elementInterrupted).toBeDefined();

    // Finish animation to 200
    await act(async () => {
       for(let i=0; i<64; i++) advanceTime(16);
    });

    expect(screen.getByText("200.00")).toBeDefined();
  });
});
