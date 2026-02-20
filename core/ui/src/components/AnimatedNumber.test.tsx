import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "@testing-library/jest-dom";

try {
  GlobalRegistrator.register();
} catch (e) {
  // Ignore
}

const { render } = await import("@testing-library/react");
const { AnimatedNumber } = await import("./AnimatedNumber");

describe("AnimatedNumber", () => {
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;

  beforeAll(() => {
    global.requestAnimationFrame = (cb) => setTimeout(cb, 16) as unknown as number;
    global.cancelAnimationFrame = (id) => clearTimeout(id);
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCAF;
  });

  it("renders the value formatted correctly", async () => {
    const { findByText } = render(<AnimatedNumber value={100} decimals={2} />);
    // @ts-ignore
    expect(await findByText("100.00")).toBeInTheDocument();
  });

  it("renders with suffix", async () => {
    const { findByText } = render(<AnimatedNumber value={50} suffix="%" />);
    // @ts-ignore
    expect(await findByText("%")).toBeInTheDocument();
  });

  it("handles undefined value", async () => {
    const { findByText } = render(<AnimatedNumber value={undefined} />);
    // @ts-ignore
    expect(await findByText("N/A")).toBeInTheDocument();
  });
});
