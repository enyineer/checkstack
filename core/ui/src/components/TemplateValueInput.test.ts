import { describe, expect, it } from "bun:test";
import { computePopupPlacement } from "./TemplateValueInput";

/**
 * Edge-aware placement for the template autocomplete popup. The popup is
 * absolutely positioned under the input by default; these guard the
 * flips that keep it inside the viewport (regression for the "dropdown
 * overflows the window edge" bug).
 */
describe("computePopupPlacement", () => {
  // A roomy 1000x800 viewport with the input near the top-left.
  const base = {
    inputTop: 100,
    inputBottom: 130,
    inputLeft: 50,
    popupWidth: 300,
    popupHeight: 200,
    viewportWidth: 1000,
    viewportHeight: 800,
  };

  it("opens down + left when there's ample room", () => {
    const placement = computePopupPlacement(base);
    expect(placement.openUp).toBe(false);
    expect(placement.alignRight).toBe(false);
  });

  it("caps the height to the space below when below is tight", () => {
    // 220px below, but the popup wants 200 — fits, so stays down and the
    // ceiling is the available space (220 - 8 margin = 212).
    const placement = computePopupPlacement({
      ...base,
      inputBottom: 580,
      popupHeight: 200,
    });
    expect(placement.openUp).toBe(false);
    expect(placement.maxHeight).toBe(212);
  });

  it("flips up when there's not enough room below and more above", () => {
    // Input low in the viewport: only ~120px below, ~660px above.
    const placement = computePopupPlacement({
      ...base,
      inputTop: 660,
      inputBottom: 690,
      popupHeight: 300,
    });
    expect(placement.openUp).toBe(true);
    // Height capped to the 288 ceiling since there's plenty of room above.
    expect(placement.maxHeight).toBe(288);
  });

  it("stays down when below is tight but above is even tighter", () => {
    // Tiny viewport where neither side fits the popup; below (larger)
    // wins, so it must not flip up.
    const placement = computePopupPlacement({
      ...base,
      inputTop: 40,
      inputBottom: 70,
      viewportHeight: 200,
      popupHeight: 300,
    });
    // spaceBelow = 200-70-8 = 122, spaceAbove = 40-8 = 32 → stay down.
    expect(placement.openUp).toBe(false);
    expect(placement.maxHeight).toBe(122);
  });

  it("anchors right when a left-anchored popup would overflow", () => {
    // Input near the right edge: left(800) + width(300) = 1100 > 1000.
    const placement = computePopupPlacement({
      ...base,
      inputLeft: 800,
    });
    expect(placement.alignRight).toBe(true);
  });

  it("keeps left anchor when the popup fits horizontally", () => {
    const placement = computePopupPlacement({
      ...base,
      inputLeft: 600,
      popupWidth: 300,
    });
    // 600 + 300 = 900 < 1000 - 8 → fits.
    expect(placement.alignRight).toBe(false);
  });

  it("never reports a height below the usable floor", () => {
    // Sandwiched input with almost no room either side.
    const placement = computePopupPlacement({
      ...base,
      inputTop: 90,
      inputBottom: 110,
      viewportHeight: 150,
      popupHeight: 300,
    });
    expect(placement.maxHeight).toBe(120);
  });
});
