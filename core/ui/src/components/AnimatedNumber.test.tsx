import { renderToString } from "react-dom/server";
import { AnimatedNumber } from "./AnimatedNumber";
import { describe, it, expect } from "bun:test";
import React from "react";

describe("AnimatedNumber SSR", () => {
  it("renders correctly on server", () => {
    const html = renderToString(<AnimatedNumber value={100} />);
    expect(html).toContain("100.00");
  });

  it("renders N/A when undefined", () => {
    const html = renderToString(<AnimatedNumber value={undefined} />);
    expect(html).toContain("N/A");
  });

  it("renders suffix", () => {
    const html = renderToString(<AnimatedNumber value={50} suffix="%" />);
    expect(html).toContain("50.00");
    expect(html).toContain("%");
  });
});
