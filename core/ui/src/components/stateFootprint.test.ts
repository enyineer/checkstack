import { describe, expect, it } from "bun:test";
import {
  DEFAULT_STATE_FOOTPRINT,
  STATE_FOOTPRINT_CLASS,
  stateFootprintClass,
} from "./stateFootprint";

describe("stateFootprint", () => {
  it("defaults to the panel footprint", () => {
    expect(DEFAULT_STATE_FOOTPRINT).toBe("panel");
    expect(stateFootprintClass()).toBe(STATE_FOOTPRINT_CLASS.panel);
  });

  it("resolves each footprint to its class", () => {
    expect(stateFootprintClass("inline")).toBe(STATE_FOOTPRINT_CLASS.inline);
    expect(stateFootprintClass("panel")).toBe(STATE_FOOTPRINT_CLASS.panel);
    expect(stateFootprintClass("chart")).toBe(STATE_FOOTPRINT_CLASS.chart);
  });

  it("matches the panel and chart footprints so loading<->error<->empty don't shift", () => {
    // EmptyState/ErrorState (panel) and the chart Skeleton variant must share a
    // min-height; this guards the no-layout-shift contract.
    expect(stateFootprintClass("panel")).toBe(stateFootprintClass("chart"));
  });
});
