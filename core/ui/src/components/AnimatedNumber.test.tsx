import { render } from "@testing-library/react";
import { AnimatedNumber } from "./AnimatedNumber";
import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";

// Mock requestAnimationFrame
const requestAnimationFrameMock = (callback: FrameRequestCallback) => {
  return setTimeout(() => callback(Date.now()), 16);
};
const cancelAnimationFrameMock = (id: any) => clearTimeout(id);

describe("AnimatedNumber", () => {
  let originalRAF: any;
  let originalCAF: any;

  beforeEach(() => {
    // Check if document exists
    if (typeof document === 'undefined') {
        console.error("Document is undefined in test!");
    }

    originalRAF = global.requestAnimationFrame;
    originalCAF = global.cancelAnimationFrame;
    global.requestAnimationFrame = requestAnimationFrameMock as any;
    global.cancelAnimationFrame = cancelAnimationFrameMock as any;
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCAF;
    vi.restoreAllMocks();
  });

  it("renders the initial value", async () => {
    const { getByText } = render(<AnimatedNumber value={100} />);
    // @ts-expect-error - toBeInTheDocument is added by setup script but not typed in bun:test
    expect(getByText("100.00")).toBeInTheDocument();
  });

  it("renders N/A when value is undefined", () => {
    const { getByText } = render(<AnimatedNumber value={undefined} />);
    // @ts-expect-error - toBeInTheDocument is added by setup script but not typed in bun:test
    expect(getByText("N/A")).toBeInTheDocument();
  });

  it("renders with suffix", () => {
    const { getByText } = render(<AnimatedNumber value={50} suffix="%" />);
    // @ts-expect-error - toBeInTheDocument is added by setup script but not typed in bun:test
    expect(getByText("50.00")).toBeInTheDocument();
    // @ts-expect-error - toBeInTheDocument is added by setup script but not typed in bun:test
    expect(getByText("%")).toBeInTheDocument();
  });
});
