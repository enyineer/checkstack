import "@checkstack/test-utils-frontend/setup";
import { afterEach, describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { TimeSeriesChart, type TimeSeries } from "./TimeSeriesChart";

const primary: TimeSeries = {
  id: "p50",
  label: "p50",
  points: [
    { x: 1_000, y: 10 },
    { x: 2_000, y: 20 },
    { x: 3_000, y: 15 },
  ],
};

/**
 * happy-dom has no layout engine: `getBoundingClientRect` reports width 0 by
 * default. Patch it per-test to simulate a real measured container.
 */
const originalGetRect = Element.prototype.getBoundingClientRect;

function mockContainerWidth(width: number) {
  Element.prototype.getBoundingClientRect = function () {
    return {
      ...originalGetRect.call(this),
      width,
    };
  };
}

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetRect;
});

describe("TimeSeriesChart", () => {
  it("draws the viewBox at the container's real pixel width (no stretching)", () => {
    mockContainerWidth(600);
    const { container } = render(
      <TimeSeriesChart primary={primary} height={192} ariaLabel="test chart" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // 1 viewBox unit = 1 CSS px: a 600px container gets a 600-unit viewBox,
    // so axis text is never scaled non-uniformly.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 600 192");
    expect(svg?.getAttribute("width")).toBe("100%");
  });

  it("keeps the vertical scale 1:1 - viewBox and SVG height always equal the height prop", () => {
    mockContainerWidth(600);
    const { container, rerender } = render(
      <TimeSeriesChart primary={primary} height={192} ariaLabel="test chart" />,
    );
    const svg = () => container.querySelector("svg");
    expect(svg()?.getAttribute("height")).toBe("192");
    expect(svg()?.getAttribute("viewBox")).toBe("0 0 600 192");
    // A changed height prop must update the viewBox and the rendered height
    // in the same pass, so the two can never disagree (no vertical stretch).
    rerender(
      <TimeSeriesChart primary={primary} height={260} ariaLabel="test chart" />,
    );
    expect(svg()?.getAttribute("height")).toBe("260");
    expect(svg()?.getAttribute("viewBox")).toBe("0 0 600 260");
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe("260px");
  });

  it("renders y-axis tick labels once measured", () => {
    mockContainerWidth(600);
    const { container } = render(
      <TimeSeriesChart primary={primary} height={192} ariaLabel="test chart" />,
    );
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("reserves the height but defers the SVG until the width is known", () => {
    // No mock: happy-dom reports width 0, i.e. "not measured yet".
    const { container } = render(
      <TimeSeriesChart primary={primary} height={192} ariaLabel="test chart" />,
    );
    expect(container.querySelector("svg")).toBeNull();
    const wrapper = container.firstElementChild as HTMLElement;
    // The wrapper still occupies the chart's final height, so the SVG
    // appearing after measurement causes no layout shift.
    expect(wrapper.style.height).toBe("192px");
  });

  it("measures and renders when data arrives after an initial no-data render", () => {
    mockContainerWidth(500);
    const { container, rerender } = render(
      <TimeSeriesChart
        primary={{ id: "p50", label: "p50", points: [] }}
        height={192}
        ariaLabel="test chart"
      />,
    );
    // No plot wrapper exists yet, so nothing was measured.
    expect(container.querySelector("svg")).toBeNull();
    rerender(
      <TimeSeriesChart primary={primary} height={192} ariaLabel="test chart" />,
    );
    // The wrapper mounted later than the hook; the callback ref must still
    // arm the measurement and render the SVG at the real width.
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 500 192",
    );
  });

  it("still shows the no-data state without any measurement", () => {
    const { container, getByText } = render(
      <TimeSeriesChart
        primary={{ id: "p50", label: "p50", points: [] }}
        height={192}
      />,
    );
    expect(getByText(/no data/i)).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
});
