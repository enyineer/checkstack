import { describe, it, expect } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { Spinner, SPINNER_FRAMES } from "./components.tsx";

describe("Spinner", () => {
  it("renders the glyph for the given frame", () => {
    expect(renderToString(<Spinner frame={0} />)).toContain(SPINNER_FRAMES[0]);
    expect(renderToString(<Spinner frame={1} />)).toContain(SPINNER_FRAMES[1]);
  });

  it("wraps the frame index over the frame set", () => {
    const len = SPINNER_FRAMES.length;
    expect(renderToString(<Spinner frame={len} />)).toContain(
      SPINNER_FRAMES[0],
    );
    expect(renderToString(<Spinner frame={len + 2} />)).toContain(
      SPINNER_FRAMES[2],
    );
  });

  it("is safe for a negative frame", () => {
    // Should not throw or render `undefined`.
    const frame = renderToString(<Spinner frame={-1} />);
    expect(frame).toContain(SPINNER_FRAMES[SPINNER_FRAMES.length - 1]);
    expect(frame).not.toContain("undefined");
  });
});
